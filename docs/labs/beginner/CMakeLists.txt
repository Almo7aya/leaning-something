cmake_minimum_required(VERSION 3.20)
project(KytyBeginnerLabs LANGUAGES CXX)
include(CTest)
foreach(lesson first_program bytes ownership machine completion cpp_idioms)
  add_executable(${lesson} ${lesson}.cpp)
  target_compile_features(${lesson} PRIVATE cxx_std_20)
  set_target_properties(${lesson} PROPERTIES CXX_EXTENSIONS OFF)
  if(BUILD_TESTING)
    add_test(NAME beginner_${lesson}
      COMMAND "${CMAKE_COMMAND}" "-DPROGRAM=$<TARGET_FILE:${lesson}>"
        "-DEXPECTED=${CMAKE_CURRENT_LIST_DIR}/${lesson}.txt"
        -P "${CMAKE_CURRENT_LIST_DIR}/check_output.cmake")
  endif()
endforeach()
