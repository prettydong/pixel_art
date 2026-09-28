#include "dev.hpp"
#include "repair_most.hpp"

#include <cctype>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct InputHeader {
  std::uint32_t chips{};
  std::uint32_t regions{};
  std::uint32_t rows{};
  std::uint32_t cols{};
  std::uint64_t fail_count{};
  std::uint64_t group_count{};
};

std::uint64_t parse_uint(const std::string& token, const char* field) {
  if (token.empty()) throw std::runtime_error(std::string("missing ") + field);
  std::uint64_t value = 0;
  for (const unsigned char ch : token) {
    if (!std::isdigit(ch)) throw std::runtime_error(std::string("invalid integer for ") + field);
    const auto digit = static_cast<std::uint64_t>(ch - '0');
    if (value > (std::numeric_limits<std::uint64_t>::max() - digit) / 10) {
      throw std::runtime_error(std::string("integer overflow for ") + field);
    }
    value = value * 10 + digit;
  }
  return value;
}

std::uint32_t parse_u32(const std::string& token, const char* field) {
  const auto value = parse_uint(token, field);
  if (value > std::numeric_limits<std::uint32_t>::max()) {
    throw std::runtime_error(std::string("integer out of range for ") + field);
  }
  return static_cast<std::uint32_t>(value);
}

std::vector<std::string> words(const std::string& line) {
  std::istringstream stream(line);
  std::vector<std::string> result;
  std::string word;
  while (stream >> word) result.push_back(word);
  return result;
}

InputHeader parse_header(const std::string& line) {
  const auto tokens = words(line);
  if (tokens.size() != 7 || tokens[0] != "PIXEL_REPAIR_INPUT_V1") {
    throw std::runtime_error("invalid input header");
  }
  InputHeader header{parse_u32(tokens[1], "chips"), parse_u32(tokens[2], "regions"),
                     parse_u32(tokens[3], "rows"), parse_u32(tokens[4], "cols"),
                     parse_uint(tokens[5], "failCount"), parse_uint(tokens[6], "groupCount")};
  if (header.chips == 0 || header.regions == 0) throw std::runtime_error("chips and regions must be positive");
  repair::checked_region_shape(header.rows, header.cols);
  const auto groups = static_cast<std::uint64_t>(header.chips) * header.regions;
  if (groups > repair::kMaxTotalRegions) throw std::runtime_error("total regions exceeds configured bound");
  if (header.group_count > groups) throw std::runtime_error("groupCount exceeds complete layout region count");
  if (header.group_count > repair::kMaxNonemptyRegions) {
    throw std::runtime_error("groupCount exceeds configured nonempty-region bound");
  }
  if (header.fail_count > repair::kMaxFailsPerWafer) {
    throw std::runtime_error("failCount exceeds configured bound");
  }
  return header;
}

std::string json_string(const std::string& text) {
  std::string out{"\""};
  for (const unsigned char ch : text) {
    switch (ch) {
      case '\"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (ch < 0x20) {
          static constexpr char hex[] = "0123456789abcdef";
          out += "\\u00";
          out += hex[ch >> 4];
          out += hex[ch & 15];
        } else {
          out += static_cast<char>(ch);
        }
    }
  }
  out += '\"';
  return out;
}

void write_progress(std::uint64_t processed, std::uint64_t total) {
  std::cout << "{\"type\":\"progress\",\"processedRegions\":" << processed
            << ",\"totalRegions\":" << total << "}\n" << std::flush;
  if (!std::cout) throw std::runtime_error("failed writing stdout progress");
}

void write_region(std::ofstream& output, const repair::Region& region,
                  const repair::Model& model, const repair::SolveResult& solved) {
  output << "{\"type\":\"region\",\"chip\":" << region.chip
         << ",\"region\":" << region.region << ",\"failCount\":" << region.fails.size()
         << ",\"status\":\"" << (solved.repaired ? "repaired" : "heuristic_unresolved")
         << "\",\"remainingFails\":" << solved.remaining_fails << ",\"selectedActions\":[";
  for (std::size_t i = 0; i < solved.selected_actions.size(); ++i) {
    if (i != 0) output << ',';
    output << json_string(solved.selected_actions[i]);
  }
  output << "],\"resourceUsage\":[";
  for (std::size_t i = 0; i < model.pools.size(); ++i) {
    if (i != 0) output << ',';
    output << "{\"id\":" << json_string(model.pools[i].id) << ",\"used\":"
           << solved.resource_usage[i] << ",\"capacity\":" << model.pools[i].capacity << '}';
  }
  output << "]}\n";
}

std::string summary_json(std::uint64_t total_regions, std::uint64_t initially_good_regions,
                         std::uint64_t repaired_regions, std::uint64_t unresolved_regions,
                         std::uint32_t total_chips, std::uint64_t initially_good_chips,
                         std::uint64_t passed_chips, std::uint64_t unresolved_chips) {
  const std::uint64_t passed_regions = initially_good_regions + repaired_regions;
  const auto region_yield = static_cast<double>(passed_regions) / static_cast<double>(total_regions);
  const auto chip_yield = static_cast<double>(passed_chips) / static_cast<double>(total_chips);
  std::ostringstream text;
  text.precision(17);
  text << "{\"type\":\"summary\",\"algorithm\":\"repairMost\",\"totalRegions\":" << total_regions
       << ",\"initiallyGoodRegions\":" << initially_good_regions << ",\"repairedRegions\":" << repaired_regions
       << ",\"passedRegions\":" << passed_regions << ",\"unresolvedRegions\":" << unresolved_regions
       << ",\"totalChips\":" << total_chips << ",\"initiallyGoodChips\":" << initially_good_chips
       << ",\"passedChips\":" << passed_chips << ",\"unresolvedChips\":" << unresolved_chips
       << ",\"regionYield\":" << region_yield << ",\"chipYield\":" << chip_yield << '}';
  return text.str();
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc != 3) throw std::runtime_error("usage: repair-solver INPUT.txt RESULTS.jsonl");
    std::ifstream input(argv[1]);
    if (!input) throw std::runtime_error("cannot open input");
    std::ofstream output(argv[2], std::ios::trunc);
    if (!output) throw std::runtime_error("cannot open results output");

    std::string line;
    if (!std::getline(input, line)) throw std::runtime_error("missing input header");
    const InputHeader header = parse_header(line);
    // Mandatory even for a wafer whose every region has zero fails.
    dev::validate_layout(header.rows, header.cols);

    const std::uint64_t total_regions = static_cast<std::uint64_t>(header.chips) * header.regions;
    std::vector<bool> chip_has_fail(header.chips, false);
    std::vector<bool> chip_unresolved(header.chips, false);
    std::uint64_t counted_fails = 0;
    // The codec emits only nonempty regions. Every omitted layout region is
    // initially good, so summary denominators still cover the full wafer.
    std::uint64_t initially_good_regions = total_regions - header.group_count;
    std::uint64_t repaired_regions = 0;
    std::uint64_t unresolved_regions = 0;

    std::uint64_t previous_group_index = 0;
    for (std::uint64_t group = 0; group < header.group_count; ++group) {
      if (!std::getline(input, line)) throw std::runtime_error("missing region group");
      const auto tokens = words(line);
      if (tokens.size() < 2) throw std::runtime_error("invalid region group");
      const auto group_index = parse_uint(tokens[0], "regionIndex");
      const auto count = parse_u32(tokens[1], "group fail count");
      if (group_index >= total_regions || count == 0 || count > repair::kMaxFailsPerRegion ||
          tokens.size() != 2ULL + count || (group != 0 && group_index <= previous_group_index)) {
        throw std::runtime_error("region groups must be nonempty, globally ordered, and correctly sized");
      }
      previous_group_index = group_index;
      counted_fails = repair::checked_add(counted_fails, count, "input fail count overflow");
      if (counted_fails > header.fail_count) throw std::runtime_error("input fail count exceeds header");
      const auto chip = static_cast<std::uint32_t>(group_index / header.regions);
      const auto region_index = static_cast<std::uint32_t>(group_index % header.regions);
      repair::Region region{header.rows, header.cols, chip, region_index, {}};
      region.fails.reserve(count);
      std::uint64_t previous_position = 0;
      const auto cells = static_cast<std::uint64_t>(header.rows) * header.cols;
      for (std::uint32_t i = 0; i < count; ++i) {
        const auto position = parse_uint(tokens[2 + i], "fail position");
        if (position >= cells || (i != 0 && position <= previous_position)) {
          throw std::runtime_error("fail positions must be valid and strictly increasing");
        }
        previous_position = position;
        region.fails.push_back({static_cast<std::uint32_t>(position / header.cols),
                                static_cast<std::uint32_t>(position % header.cols)});
      }
      chip_has_fail[chip] = true;
      repair::Model model = dev::build_model(region);
      const repair::SolveResult solved = repair::repair_most(region, model);
      write_region(output, region, model, solved);
      if (solved.repaired) ++repaired_regions;
      else { ++unresolved_regions; chip_unresolved[chip] = true; }
      if ((group + 1) % 128 == 0) {
        write_progress(group_index + 1, total_regions);
      }
    }
    if (counted_fails != header.fail_count) throw std::runtime_error("failCount does not match groups");
    while (std::getline(input, line)) {
      if (!words(line).empty()) throw std::runtime_error("trailing input data");
    }

    std::uint64_t initially_good_chips = 0, passed_chips = 0, unresolved_chips = 0;
    for (std::uint32_t chip = 0; chip < header.chips; ++chip) {
      if (!chip_has_fail[chip]) ++initially_good_chips;
      if (chip_unresolved[chip]) ++unresolved_chips;
      else ++passed_chips;
    }
    const std::string summary = summary_json(total_regions, initially_good_regions, repaired_regions,
                                             unresolved_regions, header.chips, initially_good_chips,
                                             passed_chips, unresolved_chips);
    output << summary << '\n';
    output.flush();
    if (!output) throw std::runtime_error("failed writing results output");
    output.close();
    if (output.fail()) throw std::runtime_error("failed closing results output");
    // This final progress includes omitted initially-good regions and is
    // required even for an all-good wafer.
    write_progress(total_regions, total_regions);
    std::cout << summary << '\n';
    std::cout.flush();
    if (!std::cout) throw std::runtime_error("failed writing stdout");
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "repair-solver: " << error.what() << '\n';
    return 1;
  }
}
