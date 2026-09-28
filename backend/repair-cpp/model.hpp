#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace repair {

struct Fail {
  std::uint32_t row{};
  std::uint32_t col{};
};

// A Region contains only the fails in one physical repair region.  `chip` and
// `region` are identifiers supplied by the input codec, not array indexes in
// a redundancy architecture.
struct Region {
  std::uint32_t rows{};
  std::uint32_t cols{};
  std::uint32_t chip{};
  std::uint32_t region{};
  std::vector<Fail> fails;
};

struct Pool {
  std::string id;
  std::uint64_t capacity{};
};

struct PoolCost {
  // Index into Model::pools.  Costs are positive; a pool is listed at most
  // once in an action.
  std::uint32_t pool{};
  std::uint64_t cost{};
};

struct Action {
  std::string id;
  // Indexes into Region::fails, in strictly increasing order.
  std::vector<std::uint32_t> covers;
  // Sorted by pool index, with no duplicate pool index.
  std::vector<PoolCost> uses;
};

struct Model {
  std::vector<Pool> pools;
  std::vector<Action> actions;
  // The core understands only additive, upper-bounded pool costs.  An agent
  // must put any other requested constraint here instead of silently
  // approximating it; the solver will reject the model with this message.
  std::vector<std::string> unsupported_constraints;
};

inline constexpr std::uint64_t kMaxCells = std::numeric_limits<std::uint32_t>::max();
inline constexpr std::uint32_t kMaxTotalRegions = 1'000'000;
inline constexpr std::uint32_t kMaxNonemptyRegions = 100'000;
inline constexpr std::uint32_t kMaxFailsPerRegion = 5'000'000;
inline constexpr std::uint32_t kMaxFailsPerWafer = 5'000'000;
inline constexpr std::uint32_t kMaxPools = 100'000;
inline constexpr std::uint32_t kMaxActions = 1'000'000;
inline constexpr std::uint64_t kMaxEdges = 16'000'000;
inline constexpr std::size_t kMaxIdBytes = 256;

inline void checked_region_shape(std::uint32_t rows, std::uint32_t cols) {
  if (rows == 0 || cols == 0 || rows > 1'000'000 || cols > 1'000'000) {
    throw std::runtime_error("rows and cols must be within 1..1000000");
  }
  if (static_cast<std::uint64_t>(rows) * cols > kMaxCells) {
    throw std::runtime_error("region cell count exceeds uint32 position range");
  }
}

inline std::uint64_t checked_add(std::uint64_t left, std::uint64_t right,
                                 const char* message) {
  if (right > std::numeric_limits<std::uint64_t>::max() - left) {
    throw std::runtime_error(message);
  }
  return left + right;
}

}  // namespace repair
