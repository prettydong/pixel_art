#pragma once

#include "model.hpp"

#include <algorithm>
#include <queue>
#include <sstream>

namespace repair {

struct SolveResult {
  bool repaired{};
  std::uint32_t remaining_fails{};
  std::vector<std::string> selected_actions;
  // Retained for linear-time independent postcondition verification. These
  // indexes are implementation data; the CLI exposes selected_actions IDs.
  std::vector<std::uint32_t> selected_action_indexes;
  std::vector<std::uint64_t> resource_usage;
};

inline void validate_model(const Region& region, const Model& model) {
  checked_region_shape(region.rows, region.cols);
  if (region.fails.size() > kMaxFailsPerRegion) {
    throw std::runtime_error("fail count exceeds configured bound");
  }
  std::vector<std::uint64_t> fail_positions;
  fail_positions.reserve(region.fails.size());
  for (const Fail& fail : region.fails) {
    if (fail.row >= region.rows || fail.col >= region.cols) {
      throw std::runtime_error("fail coordinate is outside region bounds");
    }
    fail_positions.push_back(static_cast<std::uint64_t>(fail.row) * region.cols + fail.col);
  }
  std::sort(fail_positions.begin(), fail_positions.end());
  if (std::adjacent_find(fail_positions.begin(), fail_positions.end()) != fail_positions.end()) {
    throw std::runtime_error("region fail coordinates must be unique");
  }
  if (!model.unsupported_constraints.empty()) {
    throw std::runtime_error("unsupported model constraint: " + model.unsupported_constraints.front());
  }
  if (model.pools.size() > kMaxPools || model.actions.size() > kMaxActions) {
    throw std::runtime_error("model item count exceeds configured bound");
  }
  std::vector<std::string> pool_ids;
  pool_ids.reserve(model.pools.size());
  for (const Pool& pool : model.pools) {
    if (pool.id.empty() || pool.id.size() > kMaxIdBytes) {
      throw std::runtime_error("pool id must be nonempty and within length bound");
    }
    pool_ids.push_back(pool.id);
  }
  std::sort(pool_ids.begin(), pool_ids.end());
  if (std::adjacent_find(pool_ids.begin(), pool_ids.end()) != pool_ids.end()) {
    throw std::runtime_error("pool ids must be unique");
  }

  std::vector<std::string> action_ids;
  action_ids.reserve(model.actions.size());
  std::uint64_t edges = 0;
  for (const Action& action : model.actions) {
    if (action.id.empty() || action.id.size() > kMaxIdBytes) {
      throw std::runtime_error("action id must be nonempty and within length bound");
    }
    if (action.covers.empty()) throw std::runtime_error("action must cover at least one fail");
    if (action.uses.empty()) throw std::runtime_error("action must use at least one pool");
    action_ids.push_back(action.id);
    edges = checked_add(edges, action.covers.size(), "model edge count overflow");
    edges = checked_add(edges, action.uses.size(), "model edge count overflow");
    if (edges > kMaxEdges) throw std::runtime_error("model edge count exceeds configured bound");
    std::uint32_t previous_cover = 0;
    for (std::size_t i = 0; i < action.covers.size(); ++i) {
      const auto index = action.covers[i];
      if (index >= region.fails.size() || (i != 0 && index <= previous_cover)) {
        throw std::runtime_error("action coverage indexes must be unique and increasing");
      }
      previous_cover = index;
    }
    std::uint32_t previous_pool = 0;
    for (std::size_t i = 0; i < action.uses.size(); ++i) {
      const PoolCost& use = action.uses[i];
      if (use.pool >= model.pools.size() || use.cost == 0 ||
          (i != 0 && use.pool <= previous_pool)) {
        throw std::runtime_error("action resources must have valid unique increasing pool indexes and positive costs");
      }
      previous_pool = use.pool;
    }
  }
  std::sort(action_ids.begin(), action_ids.end());
  if (std::adjacent_find(action_ids.begin(), action_ids.end()) != action_ids.end()) {
    throw std::runtime_error("action ids must be unique");
  }
}

struct HeapEntry {
  std::uint32_t gain{};
  std::uint32_t action{};
  std::uint64_t generation{};
};

struct HeapOrder {
  const std::vector<Action>* actions{};
  bool operator()(const HeapEntry& left, const HeapEntry& right) const {
    if (left.gain != right.gain) return left.gain < right.gain;
    // priority_queue puts the element for which comparison is false at top.
    return (*actions)[left.action].id > (*actions)[right.action].id;
  }
};

inline bool has_budget(const Action& action, const Model& model,
                       const std::vector<std::uint64_t>& used) {
  for (const PoolCost& cost : action.uses) {
    if (cost.cost > model.pools[cost.pool].capacity - used[cost.pool]) return false;
  }
  return true;
}

inline SolveResult repair_most(const Region& region, const Model& model) {
  validate_model(region, model);
  SolveResult result;
  result.resource_usage.assign(model.pools.size(), 0);
  if (region.fails.empty()) {
    result.repaired = true;
    return result;
  }

  std::vector<std::vector<std::uint32_t>> inverted(region.fails.size());
  std::vector<std::uint32_t> gains(model.actions.size());
  std::uint64_t inverted_edges = 0;
  for (std::uint32_t action_index = 0; action_index < model.actions.size(); ++action_index) {
    const Action& action = model.actions[action_index];
    gains[action_index] = static_cast<std::uint32_t>(action.covers.size());
    for (const std::uint32_t fail_index : action.covers) {
      inverted[fail_index].push_back(action_index);
      inverted_edges = checked_add(inverted_edges, 1, "inverted coverage overflow");
    }
  }
  if (inverted_edges > kMaxEdges) throw std::runtime_error("inverted coverage exceeds configured bound");

  HeapOrder order{&model.actions};
  std::priority_queue<HeapEntry, std::vector<HeapEntry>, HeapOrder> ready(order);
  std::vector<std::uint64_t> generations(model.actions.size(), 0);
  for (std::uint32_t i = 0; i < model.actions.size(); ++i) ready.push({gains[i], i, 0});
  std::vector<bool> covered(region.fails.size(), false);
  std::uint32_t remaining = static_cast<std::uint32_t>(region.fails.size());

  while (!ready.empty() && remaining != 0) {
    const HeapEntry entry = ready.top();
    ready.pop();
    if (entry.generation != generations[entry.action] || entry.gain != gains[entry.action]) continue;
    if (entry.gain == 0) break;
    const Action& action = model.actions[entry.action];
    if (!has_budget(action, model, result.resource_usage)) continue;

    for (const PoolCost& cost : action.uses) {
      result.resource_usage[cost.pool] = checked_add(result.resource_usage[cost.pool], cost.cost,
                                                     "resource usage overflow");
    }
    result.selected_actions.push_back(action.id);
    result.selected_action_indexes.push_back(entry.action);
    for (const std::uint32_t fail_index : action.covers) {
      if (covered[fail_index]) continue;
      covered[fail_index] = true;
      --remaining;
      for (const std::uint32_t affected : inverted[fail_index]) {
        if (gains[affected] == 0) throw std::runtime_error("internal gain underflow");
        --gains[affected];
        ++generations[affected];
        if (gains[affected] != 0) ready.push({gains[affected], affected, generations[affected]});
      }
    }
  }

  // Independent postcondition check: do not trust the incremental bookkeeping.
  std::vector<bool> checked(region.fails.size(), false);
  std::vector<std::uint64_t> checked_usage(model.pools.size(), 0);
  if (result.selected_actions.size() != result.selected_action_indexes.size()) {
    throw std::runtime_error("internal selected action bookkeeping mismatch");
  }
  for (std::size_t selected_index = 0; selected_index < result.selected_action_indexes.size(); ++selected_index) {
    const std::uint32_t action_index = result.selected_action_indexes[selected_index];
    if (action_index >= model.actions.size()) throw std::runtime_error("internal selected action index invalid");
    const Action& selected = model.actions[action_index];
    if (selected.id != result.selected_actions[selected_index]) {
      throw std::runtime_error("internal selected action id mismatch");
    }
    for (const PoolCost& cost : selected.uses) {
      checked_usage[cost.pool] = checked_add(checked_usage[cost.pool], cost.cost,
                                             "postcheck resource overflow");
    }
    for (const std::uint32_t fail_index : selected.covers) checked[fail_index] = true;
  }
  for (std::size_t i = 0; i < checked_usage.size(); ++i) {
    if (checked_usage[i] > model.pools[i].capacity) throw std::runtime_error("postcheck budget violated");
  }
  const auto checked_remaining = static_cast<std::uint32_t>(
      std::count(checked.begin(), checked.end(), false));
  if (checked_remaining != remaining || checked_usage != result.resource_usage) {
    throw std::runtime_error("internal postcheck mismatch");
  }
  result.remaining_fails = checked_remaining;
  result.repaired = checked_remaining == 0;
  return result;
}

}  // namespace repair
