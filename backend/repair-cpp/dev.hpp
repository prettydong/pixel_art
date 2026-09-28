#pragma once

// This is the only file intended for architecture agents to edit.  The trusted
// solver validates every Model returned here before using it.

#include "model.hpp"

#include <cstdint>
#include <stdexcept>

namespace dev {

inline void validate_layout(std::uint32_t /*rows*/, std::uint32_t /*cols*/) {
  throw std::runtime_error(
      "no redundancy architecture installed: implement dev::validate_layout and dev::build_model");
}

inline repair::Model build_model(const repair::Region& /*region*/) {
  throw std::runtime_error(
      "no redundancy architecture installed: implement dev::validate_layout and dev::build_model");
}

}  // namespace dev
