{
  "targets": [
    {
      "target_name": "orca_windows_security",
      "sources": ["src/addon.cc", "src/isolated-spawn.cc", "src/managed-job-process.cc", "src/managed-motor-lease.cc", "src/managed-listener-census.cc", "src/managed-recorded-process.cc"],
      "libraries": ["advapi32.lib", "iphlpapi.lib", "ws2_32.lib"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "UNICODE", "_UNICODE"],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 0 }
      },
      "conditions": [
        ["OS!='win'", { "sources": [] , "type": "none" }]
      ]
    }
  ]
}
