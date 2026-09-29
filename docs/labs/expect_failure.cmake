# A crash, missing executable, or unrelated failure is NOT a successful red test.
execute_process(COMMAND "${LAB_EXECUTABLE}" "${LAB}" buggy
  RESULT_VARIABLE result OUTPUT_VARIABLE output ERROR_VARIABLE error)
set(expected_alignment "FAIL [alignment] cross-page: expected [0,32768), got [0,16384)")
set(expected_lifetime "FAIL [lifetime] cutoff-4: expected B, got B,A")
set(expected_contract "FAIL [contract] invalid-size: output changed on error")
string(STRIP "${output}" actual)
if(NOT "${result}" STREQUAL "1" OR NOT "${actual}" STREQUAL "${expected_${LAB}}" OR NOT "${error}" STREQUAL "")
  message(FATAL_ERROR "Unexpected result for ${LAB}: exit=${result}\n${output}\n${error}")
endif()
message(STATUS "Confirmed intentional failure: ${actual}")
