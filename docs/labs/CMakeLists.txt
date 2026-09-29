cmake_minimum_required(VERSION 3.20)
project(KytyDeveloperLabs LANGUAGES CXX)
include(CTest)

get_filename_component(LEARNING_ROOT "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
set(KYTY_SOURCE_DIR "${LEARNING_ROOT}/KytyPS5" CACHE PATH "KytyPS5 source checkout")
foreach(required src/common/alignment.h src/common/lruCache.h tests/LruCacheTests.cpp)
  if(NOT EXISTS "${KYTY_SOURCE_DIR}/${required}")
    message(FATAL_ERROR "Missing ${required}; set KYTY_SOURCE_DIR to the emulator checkout")
  endif()
endforeach()

add_executable(developer_labs developer_labs.cpp)
add_executable(upstream_lru_tests "${KYTY_SOURCE_DIR}/tests/LruCacheTests.cpp")
foreach(target developer_labs upstream_lru_tests)
  target_compile_features(${target} PRIVATE cxx_std_20)
  target_include_directories(${target} PRIVATE "${KYTY_SOURCE_DIR}/src")
endforeach()

if(BUILD_TESTING)
  foreach(lab alignment lifetime contract)
    add_test(NAME ${lab}_fixed COMMAND developer_labs ${lab} fixed)
    add_test(NAME ${lab}_expected_failure
      COMMAND "${CMAKE_COMMAND}" "-DLAB_EXECUTABLE=$<TARGET_FILE:developer_labs>"
        "-DLAB=${lab}" -P "${CMAKE_CURRENT_LIST_DIR}/expect_failure.cmake")
  endforeach()
  add_test(NAME upstream_lru COMMAND upstream_lru_tests)
endif()
