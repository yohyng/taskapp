# 0.8.0の測定原票

## Linux CI

- コード: 30e02ea7eee735ec3f4c8474013f80dbb028a2e9
- [CI 40505863659](https://github.com/yohyng/taskapp/actions/runs/40505863659)、performance job 122194886593。
- 合成一万行6件・18組が成功。テストの再試行0、約8.1分。
- revisionはGitHub ActionsがcheckoutしたPRの合成merge commitで、headと区別する。
- projectionComparisonは同じ実行内の文書編集と表示用データ更新の比較。保存・通信・DOMは含まない。

```json
[
  {
    "engine": "yjs",
    "browser": "chromium",
    "version": "153.0.8010.12",
    "platform": "linux",
    "release": "6.17.0-1022-azure",
    "cpu": "AMD EPYC 7763 64-Core Processor",
    "cpuCount": 4,
    "memoryBytes": 16766410752,
    "node": "v24.21.0",
    "revision": "d513aa1f0a3c0622cacb1316c1a743e4751c3039",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 57.5,
          "input": [],
          "moduleReadyMs": 109.10000000000582,
          "rowsReadyMs": 571.2000000000116,
          "rowsFrameMs": 596.3999999999942
        },
        "coldB": {
          "moduleStartMs": 36.20000000001164,
          "input": [],
          "moduleReadyMs": 75.5,
          "rowsReadyMs": 317.29999999998836,
          "rowsFrameMs": 342.29999999998836
        },
        "warmOffline": {
          "moduleStartMs": 19.60000000000582,
          "input": [],
          "moduleReadyMs": 27.89999999999418,
          "rowsReadyMs": 185.29999999998836,
          "rowsFrameMs": 197.89999999999418
        },
        "edits": [
          {
            "localMs": 26.5,
            "frameMs": 31.5,
            "remoteObservedMs": 37.05710099999942,
            "serverConfirmedMs": 1602.656536999999
          },
          {
            "localMs": 22.29999999998836,
            "frameMs": 28.699999999982538,
            "remoteObservedMs": 34.86938799999916,
            "serverConfirmedMs": 1616.3494620000001
          },
          {
            "localMs": 16.20000000001164,
            "frameMs": 26.900000000023283,
            "remoteObservedMs": 25.463627000000997,
            "serverConfirmedMs": 1568.1935410000006
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683060
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 63.90000000002328,
          "input": [],
          "moduleReadyMs": 108.5,
          "rowsReadyMs": 455.5,
          "rowsFrameMs": 484.70000000001164
        },
        "coldB": {
          "moduleStartMs": 32.69999999998254,
          "input": [],
          "moduleReadyMs": 68.69999999998254,
          "rowsReadyMs": 300.79999999998836,
          "rowsFrameMs": 326.79999999998836
        },
        "warmOffline": {
          "moduleStartMs": 19.099999999976717,
          "input": [],
          "moduleReadyMs": 27.899999999965075,
          "rowsReadyMs": 193,
          "rowsFrameMs": 199.59999999997672
        },
        "edits": [
          {
            "localMs": 23.20000000001164,
            "frameMs": 21.60000000000582,
            "remoteObservedMs": 31.88978599999973,
            "serverConfirmedMs": 1584.9397759999993
          },
          {
            "localMs": 22.5,
            "frameMs": 29.900000000023283,
            "remoteObservedMs": 29.46495800000048,
            "serverConfirmedMs": 1532.5002220000024
          },
          {
            "localMs": 17.099999999976717,
            "frameMs": 27.79999999998836,
            "remoteObservedMs": 27.7235159999982,
            "serverConfirmedMs": 1584.0687289999987
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683169
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 39,
          "input": [],
          "moduleReadyMs": 82.79999999998836,
          "rowsReadyMs": 441.70000000001164,
          "rowsFrameMs": 468.0999999999767
        },
        "coldB": {
          "moduleStartMs": 31.70000000001164,
          "input": [],
          "moduleReadyMs": 67.90000000002328,
          "rowsReadyMs": 358,
          "rowsFrameMs": 384.5
        },
        "warmOffline": {
          "moduleStartMs": 19.400000000023283,
          "input": [],
          "moduleReadyMs": 28.79999999998836,
          "rowsReadyMs": 192.29999999998836,
          "rowsFrameMs": 198.20000000001164
        },
        "edits": [
          {
            "localMs": 19.099999999976717,
            "frameMs": 26.79999999998836,
            "remoteObservedMs": 30.890214999999444,
            "serverConfirmedMs": 1610.5971600000048
          },
          {
            "localMs": 24.70000000001164,
            "frameMs": 30.400000000023283,
            "remoteObservedMs": 33.21298599999864,
            "serverConfirmedMs": 1535.0037489999959
          },
          {
            "localMs": 15.400000000023283,
            "frameMs": 24.900000000023283,
            "remoteObservedMs": 22.14464399999997,
            "serverConfirmedMs": 1597.996235999999
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683278
      }
    ]
  },
  {
    "engine": "powersync",
    "browser": "chromium",
    "version": "153.0.8010.12",
    "platform": "linux",
    "release": "6.17.0-1022-azure",
    "cpu": "AMD EPYC 7763 64-Core Processor",
    "cpuCount": 4,
    "memoryBytes": 16766410752,
    "node": "v24.21.0",
    "revision": "d513aa1f0a3c0622cacb1316c1a743e4751c3039",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 44.59999999997672,
          "input": [],
          "moduleReadyMs": 76.29999999998836,
          "rowsReadyMs": 2006.6999999999534,
          "rowsFrameMs": 2033.5
        },
        "coldB": {
          "moduleStartMs": 29.70000000001164,
          "input": [],
          "moduleReadyMs": 53.399999999965075,
          "rowsReadyMs": 2240.2000000000116,
          "rowsFrameMs": 2266.5
        },
        "warmOffline": {
          "moduleStartMs": 26,
          "input": [],
          "moduleReadyMs": 35.29999999998836,
          "rowsReadyMs": 804.2000000000116,
          "rowsFrameMs": 825.2000000000116
        },
        "edits": [
          {
            "localMs": 1476.0999999999767,
            "frameMs": 18.79999999998836,
            "remoteObservedMs": 1313.9783769999995,
            "serverConfirmedMs": 2638.7108089999965
          },
          {
            "localMs": 1135.2999999999884,
            "frameMs": 20.900000000023283,
            "remoteObservedMs": 1299.51685,
            "serverConfirmedMs": 2318.3787109999976
          },
          {
            "localMs": 1251.2000000000116,
            "frameMs": 22.899999999965075,
            "remoteObservedMs": 1293.6091900000029,
            "serverConfirmedMs": 2378.772075999994
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855636
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 49.20000000001164,
          "input": [],
          "moduleReadyMs": 79.20000000001164,
          "rowsReadyMs": 2007.4000000000233,
          "rowsFrameMs": 2035.2000000000116
        },
        "coldB": {
          "moduleStartMs": 31.79999999998836,
          "input": [],
          "moduleReadyMs": 57.29999999998836,
          "rowsReadyMs": 1922.899999999965,
          "rowsFrameMs": 1953.899999999965
        },
        "warmOffline": {
          "moduleStartMs": 30.099999999976717,
          "input": [],
          "moduleReadyMs": 40.5,
          "rowsReadyMs": 886.2000000000116,
          "rowsFrameMs": 914.5999999999767
        },
        "edits": [
          {
            "localMs": 1148.0999999999767,
            "frameMs": 27,
            "remoteObservedMs": 1300.7997469999973,
            "serverConfirmedMs": 2325.6354069999943
          },
          {
            "localMs": 1118.5,
            "frameMs": 30.70000000001164,
            "remoteObservedMs": 1296.6424140000017,
            "serverConfirmedMs": 2373.2839959999983
          },
          {
            "localMs": 1338.0999999999767,
            "frameMs": 19.79999999998836,
            "remoteObservedMs": 1296.3887509999913,
            "serverConfirmedMs": 2422.184559000001
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855692
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 42.300000000046566,
          "input": [],
          "moduleReadyMs": 69.5,
          "rowsReadyMs": 1984.4000000000233,
          "rowsFrameMs": 2003.600000000035
        },
        "coldB": {
          "moduleStartMs": 31.79999999998836,
          "input": [],
          "moduleReadyMs": 53.899999999965075,
          "rowsReadyMs": 1968.7999999999884,
          "rowsFrameMs": 1998.5
        },
        "warmOffline": {
          "moduleStartMs": 23.5,
          "input": [],
          "moduleReadyMs": 33.800000000046566,
          "rowsReadyMs": 824.5,
          "rowsFrameMs": 855.6000000000349
        },
        "edits": [
          {
            "localMs": 1156.8000000000466,
            "frameMs": 23.600000000034925,
            "remoteObservedMs": 1316.120670999997,
            "serverConfirmedMs": 2380.137644000002
          },
          {
            "localMs": 1308.4000000000233,
            "frameMs": 29.5,
            "remoteObservedMs": 1298.3786519999994,
            "serverConfirmedMs": 2277.852025999993
          },
          {
            "localMs": 1154.0999999999767,
            "frameMs": 30.29999999998836,
            "remoteObservedMs": 1296.6422519999905,
            "serverConfirmedMs": 2338.7997269999905
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855748
      }
    ]
  },
  {
    "engine": "loro",
    "browser": "chromium",
    "version": "153.0.8010.12",
    "platform": "linux",
    "release": "6.17.0-1022-azure",
    "cpu": "AMD EPYC 7763 64-Core Processor",
    "cpuCount": 4,
    "memoryBytes": 16766410752,
    "node": "v24.21.0",
    "revision": "d513aa1f0a3c0622cacb1316c1a743e4751c3039",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 45.79999999998836,
          "input": [],
          "moduleReadyMs": 185.09999999997672,
          "rowsReadyMs": 1194.5,
          "rowsFrameMs": 1392.399999999965
        },
        "coldB": {
          "moduleStartMs": 33.40000000002328,
          "input": [],
          "moduleReadyMs": 97.29999999998836,
          "rowsReadyMs": 1194.7000000000116,
          "rowsFrameMs": 1388.2999999999884
        },
        "warmOffline": {
          "moduleStartMs": 54.70000000001164,
          "input": [],
          "moduleReadyMs": 95.09999999997672,
          "rowsReadyMs": 432.9000000000233,
          "rowsFrameMs": 435.5
        },
        "edits": [
          {
            "localMs": 48.5,
            "frameMs": 44.899999999965075,
            "remoteObservedMs": 275.1993599999987,
            "serverConfirmedMs": 1149.4618139999802
          },
          {
            "localMs": 39.600000000034925,
            "frameMs": 38.70000000001164,
            "remoteObservedMs": 229.4854939999932,
            "serverConfirmedMs": 1136.8781250000175
          },
          {
            "localMs": 39.29999999998836,
            "frameMs": 36.29999999998836,
            "remoteObservedMs": 236.5540429999819,
            "serverConfirmedMs": 1103.8572949999943
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1017560,
        "projectionBefore": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 0
        },
        "projectionAfter": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 3
        }
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 37.09999999997672,
          "input": [],
          "moduleReadyMs": 130.09999999997672,
          "rowsReadyMs": 1211.1999999999534,
          "rowsFrameMs": 1400.2999999999884
        },
        "coldB": {
          "moduleStartMs": 35.100000000034925,
          "input": [],
          "moduleReadyMs": 101.60000000003492,
          "rowsReadyMs": 1226,
          "rowsFrameMs": 1425.100000000035
        },
        "warmOffline": {
          "moduleStartMs": 21.099999999976717,
          "input": [],
          "moduleReadyMs": 83.79999999998836,
          "rowsReadyMs": 432.79999999998836,
          "rowsFrameMs": 435.5
        },
        "edits": [
          {
            "localMs": 51.100000000034925,
            "frameMs": 48.20000000001164,
            "remoteObservedMs": 241.82555000000866,
            "serverConfirmedMs": 1133.6574099999852
          },
          {
            "localMs": 39.29999999998836,
            "frameMs": 37.40000000002328,
            "remoteObservedMs": 229.9409760000126,
            "serverConfirmedMs": 1113.1605870000203
          },
          {
            "localMs": 42.100000000034925,
            "frameMs": 39.90000000002328,
            "remoteObservedMs": 226.30736099998467,
            "serverConfirmedMs": 1099.099866000004
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1017848,
        "projectionBefore": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 0
        },
        "projectionAfter": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 3
        }
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 46.29999999998836,
          "input": [],
          "moduleReadyMs": 131.29999999998836,
          "rowsReadyMs": 1222.0999999999767,
          "rowsFrameMs": 1410.1999999999534
        },
        "coldB": {
          "moduleStartMs": 36.5,
          "input": [],
          "moduleReadyMs": 120.79999999998836,
          "rowsReadyMs": 1305.5999999999767,
          "rowsFrameMs": 1514.4000000000233
        },
        "warmOffline": {
          "moduleStartMs": 24.600000000034925,
          "input": [],
          "moduleReadyMs": 78.40000000002328,
          "rowsReadyMs": 424,
          "rowsFrameMs": 427.9000000000233
        },
        "edits": [
          {
            "localMs": 51,
            "frameMs": 48.100000000034925,
            "remoteObservedMs": 240.2375250000041,
            "serverConfirmedMs": 1143.6276249999937
          },
          {
            "localMs": 39.399999999965075,
            "frameMs": 37.09999999997672,
            "remoteObservedMs": 324.77951100000064,
            "serverConfirmedMs": 1206.0960420000192
          },
          {
            "localMs": 38.199999999953434,
            "frameMs": 35.59999999997672,
            "remoteObservedMs": 221.76166100002592,
            "serverConfirmedMs": 1140.9334210000234
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018084,
        "projectionBefore": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 0
        },
        "projectionAfter": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 3
        }
      }
    ],
    "encodingImport": [
      {
        "mode": "snapshot",
        "repeat": 0,
        "bytes": 1018006,
        "importMs": 1.099999999976717,
        "projectionMs": 213.20000000001164,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 1,
        "bytes": 1018006,
        "importMs": 2,
        "projectionMs": 231.89999999996508,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 2,
        "bytes": 1018006,
        "importMs": 1.7000000000116415,
        "projectionMs": 255.60000000003492,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 0,
        "bytes": 896622,
        "importMs": 230,
        "projectionMs": 108,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 1,
        "bytes": 896622,
        "importMs": 175.10000000003492,
        "projectionMs": 101.09999999997672,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 2,
        "bytes": 896622,
        "importMs": 175.39999999996508,
        "projectionMs": 101.10000000003492,
        "allRowsMatch": true
      }
    ],
    "projectionComparison": [
      {
        "mode": "full",
        "repeat": 0,
        "editAndProjectionMs": 210,
        "allRowsMatch": true,
        "indexedRows": 10000
      },
      {
        "mode": "full",
        "repeat": 1,
        "editAndProjectionMs": 285.0999999999767,
        "allRowsMatch": true,
        "indexedRows": 10000
      },
      {
        "mode": "full",
        "repeat": 2,
        "editAndProjectionMs": 290.29999999998836,
        "allRowsMatch": true,
        "indexedRows": 10000
      },
      {
        "mode": "full",
        "repeat": 3,
        "editAndProjectionMs": 268.8999999999651,
        "allRowsMatch": true,
        "indexedRows": 10000
      },
      {
        "mode": "full",
        "repeat": 4,
        "editAndProjectionMs": 220,
        "allRowsMatch": true,
        "indexedRows": 10000
      },
      {
        "mode": "incremental",
        "repeat": 0,
        "editAndProjectionMs": 0.7000000000116415,
        "allRowsMatch": true,
        "projection": {
          "fullRebuilds": 1,
          "fullRowReads": 10000,
          "incrementalRowReads": 2
        }
      },
      {
        "mode": "incremental",
        "repeat": 1,
        "editAndProjectionMs": 0.7000000000116415,
        "allRowsMatch": true,
        "projection": {
          "fullRebuilds": 1,
          "fullRowReads": 10000,
          "incrementalRowReads": 3
        }
      },
      {
        "mode": "incremental",
        "repeat": 2,
        "editAndProjectionMs": 0.7999999999883585,
        "allRowsMatch": true,
        "projection": {
          "fullRebuilds": 1,
          "fullRowReads": 10000,
          "incrementalRowReads": 4
        }
      },
      {
        "mode": "incremental",
        "repeat": 3,
        "editAndProjectionMs": 0.6999999999534339,
        "allRowsMatch": true,
        "projection": {
          "fullRebuilds": 1,
          "fullRowReads": 10000,
          "incrementalRowReads": 5
        }
      },
      {
        "mode": "incremental",
        "repeat": 4,
        "editAndProjectionMs": 0.5999999999767169,
        "allRowsMatch": true,
        "projection": {
          "fullRebuilds": 1,
          "fullRowReads": 10000,
          "incrementalRowReads": 6
        }
      }
    ]
  },
  {
    "engine": "yjs",
    "browser": "webkit",
    "version": "26.6",
    "platform": "linux",
    "release": "6.17.0-1022-azure",
    "cpu": "AMD EPYC 7763 64-Core Processor",
    "cpuCount": 4,
    "memoryBytes": 16766410752,
    "node": "v24.21.0",
    "revision": "d513aa1f0a3c0622cacb1316c1a743e4751c3039",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 47,
          "input": [],
          "moduleReadyMs": 110,
          "rowsReadyMs": 542,
          "rowsFrameMs": 578
        },
        "coldB": {
          "moduleStartMs": 25,
          "input": [],
          "moduleReadyMs": 69,
          "rowsReadyMs": 349,
          "rowsFrameMs": 384
        },
        "warmOffline": {
          "moduleStartMs": 12,
          "input": [],
          "moduleReadyMs": 37,
          "rowsReadyMs": 285,
          "rowsFrameMs": 311
        },
        "edits": [
          {
            "localMs": 55,
            "frameMs": 137,
            "remoteObservedMs": 56.591543000000456,
            "serverConfirmedMs": 791.1260790000015
          },
          {
            "localMs": 35,
            "frameMs": 47,
            "remoteObservedMs": 38.54389100000117,
            "serverConfirmedMs": 1479.4481539999997
          },
          {
            "localMs": 43,
            "frameMs": 53,
            "remoteObservedMs": 45.44611799999984,
            "serverConfirmedMs": 1432.3095990000002
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683381
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 52,
          "input": [],
          "moduleReadyMs": 89,
          "rowsReadyMs": 530,
          "rowsFrameMs": 572
        },
        "coldB": {
          "moduleStartMs": 24,
          "input": [],
          "moduleReadyMs": 64,
          "rowsReadyMs": 326,
          "rowsFrameMs": 361
        },
        "warmOffline": {
          "moduleStartMs": 16,
          "input": [],
          "moduleReadyMs": 46,
          "rowsReadyMs": 270,
          "rowsFrameMs": 297
        },
        "edits": [
          {
            "localMs": 43,
            "frameMs": 74,
            "remoteObservedMs": 41.947325000001,
            "serverConfirmedMs": 1493.0221009999987
          },
          {
            "localMs": 40,
            "frameMs": 49,
            "remoteObservedMs": 39.035962999998446,
            "serverConfirmedMs": 1405.3939949999985
          },
          {
            "localMs": 47,
            "frameMs": 51,
            "remoteObservedMs": 40.34745000000112,
            "serverConfirmedMs": 1456.330850000002
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683484
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 40,
          "input": [],
          "moduleReadyMs": 96,
          "rowsReadyMs": 531,
          "rowsFrameMs": 567
        },
        "coldB": {
          "moduleStartMs": 25,
          "input": [],
          "moduleReadyMs": 67,
          "rowsReadyMs": 322,
          "rowsFrameMs": 358
        },
        "warmOffline": {
          "moduleStartMs": 16,
          "input": [],
          "moduleReadyMs": 38,
          "rowsReadyMs": 266,
          "rowsFrameMs": 293
        },
        "edits": [
          {
            "localMs": 43,
            "frameMs": 58,
            "remoteObservedMs": 43.65035500000522,
            "serverConfirmedMs": 1480.331769000004
          },
          {
            "localMs": 33,
            "frameMs": 45,
            "remoteObservedMs": 36.845570000004955,
            "serverConfirmedMs": 1444.3717410000027
          },
          {
            "localMs": 35,
            "frameMs": 51,
            "remoteObservedMs": 31.682951000002504,
            "serverConfirmedMs": 1450.5545500000007
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683587
      }
    ]
  },
  {
    "engine": "powersync",
    "browser": "webkit",
    "version": "26.6",
    "platform": "linux",
    "release": "6.17.0-1022-azure",
    "cpu": "AMD EPYC 7763 64-Core Processor",
    "cpuCount": 4,
    "memoryBytes": 16766410752,
    "node": "v24.21.0",
    "revision": "d513aa1f0a3c0622cacb1316c1a743e4751c3039",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 36,
          "input": [],
          "moduleReadyMs": 81,
          "rowsReadyMs": 3950,
          "rowsFrameMs": 3999
        },
        "coldB": {
          "moduleStartMs": 49,
          "input": [],
          "moduleReadyMs": 84,
          "rowsReadyMs": 6031,
          "rowsFrameMs": 6085
        },
        "warmOffline": {
          "moduleStartMs": 29,
          "input": [],
          "moduleReadyMs": 43,
          "rowsReadyMs": 1024,
          "rowsFrameMs": 1054
        },
        "edits": [
          {
            "localMs": 2883,
            "frameMs": 87,
            "remoteObservedMs": 2352.3420719999995,
            "serverConfirmedMs": 5261.2864490000065
          },
          {
            "localMs": 6077,
            "frameMs": 25,
            "remoteObservedMs": 2831.8255479999934,
            "serverConfirmedMs": 8107.9445479999995
          },
          {
            "localMs": 4007,
            "frameMs": 18,
            "remoteObservedMs": 2812.0290769999992,
            "serverConfirmedMs": 5713.977804000009
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855798
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 46,
          "input": [],
          "moduleReadyMs": 78,
          "rowsReadyMs": 3861,
          "rowsFrameMs": 3908
        },
        "coldB": {
          "moduleStartMs": 56,
          "input": [],
          "moduleReadyMs": 87,
          "rowsReadyMs": 6372,
          "rowsFrameMs": 6437
        },
        "warmOffline": {
          "moduleStartMs": 19,
          "input": [],
          "moduleReadyMs": 30,
          "rowsReadyMs": 1082,
          "rowsFrameMs": 1133
        },
        "edits": [
          {
            "localMs": 2717,
            "frameMs": 70,
            "remoteObservedMs": 2861.4525830000057,
            "serverConfirmedMs": 4689.600841000007
          },
          {
            "localMs": 6333,
            "frameMs": 23,
            "remoteObservedMs": 2841.262620999987,
            "serverConfirmedMs": 8902.980051000006
          },
          {
            "localMs": 5551,
            "frameMs": 22,
            "remoteObservedMs": 3836.7146270000085,
            "serverConfirmedMs": 7305.824909000017
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855848
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 37,
          "input": [],
          "moduleReadyMs": 113,
          "rowsReadyMs": 3962,
          "rowsFrameMs": 4003
        },
        "coldB": {
          "moduleStartMs": 65,
          "input": [],
          "moduleReadyMs": 119,
          "rowsReadyMs": 6412,
          "rowsFrameMs": 6462
        },
        "warmOffline": {
          "moduleStartMs": 25,
          "input": [],
          "moduleReadyMs": 40,
          "rowsReadyMs": 1029,
          "rowsFrameMs": 1056
        },
        "edits": [
          {
            "localMs": 2890,
            "frameMs": 52,
            "remoteObservedMs": 2386.2760849999904,
            "serverConfirmedMs": 5512.94752300001
          },
          {
            "localMs": 6583,
            "frameMs": 31,
            "remoteObservedMs": 3337.9334369999997,
            "serverConfirmedMs": 9152.633717000019
          },
          {
            "localMs": 5018,
            "frameMs": 15,
            "remoteObservedMs": 3887.08387100001,
            "serverConfirmedMs": 7133.360218000016
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855898
      }
    ]
  },
  {
    "engine": "loro",
    "browser": "webkit",
    "version": "26.6",
    "platform": "linux",
    "release": "6.17.0-1022-azure",
    "cpu": "AMD EPYC 7763 64-Core Processor",
    "cpuCount": 4,
    "memoryBytes": 16766410752,
    "node": "v24.21.0",
    "revision": "d513aa1f0a3c0622cacb1316c1a743e4751c3039",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 54,
          "input": [],
          "moduleReadyMs": 209,
          "rowsReadyMs": 1308,
          "rowsFrameMs": 1510
        },
        "coldB": {
          "moduleStartMs": 25,
          "input": [],
          "moduleReadyMs": 136,
          "rowsReadyMs": 1229,
          "rowsFrameMs": 1439
        },
        "warmOffline": {
          "moduleStartMs": 17,
          "input": [],
          "moduleReadyMs": 126,
          "rowsReadyMs": 577,
          "rowsFrameMs": 603
        },
        "edits": [
          {
            "localMs": 69,
            "frameMs": 87,
            "remoteObservedMs": 264.1295950000058,
            "serverConfirmedMs": 1100.774927999999
          },
          {
            "localMs": 56,
            "frameMs": 70,
            "remoteObservedMs": 253.509258999984,
            "serverConfirmedMs": 1073.45655599999
          },
          {
            "localMs": 53,
            "frameMs": 67,
            "remoteObservedMs": 238.57364399998914,
            "serverConfirmedMs": 1047.022140999994
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018325,
        "projectionBefore": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 0
        },
        "projectionAfter": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 3
        }
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 39,
          "input": [],
          "moduleReadyMs": 196,
          "rowsReadyMs": 1260,
          "rowsFrameMs": 1461
        },
        "coldB": {
          "moduleStartMs": 26,
          "input": [],
          "moduleReadyMs": 145,
          "rowsReadyMs": 1298,
          "rowsFrameMs": 1550
        },
        "warmOffline": {
          "moduleStartMs": 15,
          "input": [],
          "moduleReadyMs": 120,
          "rowsReadyMs": 577,
          "rowsFrameMs": 605
        },
        "edits": [
          {
            "localMs": 72,
            "frameMs": 85,
            "remoteObservedMs": 285.8903960000025,
            "serverConfirmedMs": 1086.9067639999848
          },
          {
            "localMs": 54,
            "frameMs": 66,
            "remoteObservedMs": 237.28590200000326,
            "serverConfirmedMs": 1055.9306489999872
          },
          {
            "localMs": 62,
            "frameMs": 77,
            "remoteObservedMs": 364.95946600000025,
            "serverConfirmedMs": 1195.1632930000196
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018567,
        "projectionBefore": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 0
        },
        "projectionAfter": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 3
        }
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 36,
          "input": [],
          "moduleReadyMs": 179,
          "rowsReadyMs": 1300,
          "rowsFrameMs": 1523
        },
        "coldB": {
          "moduleStartMs": 24,
          "input": [],
          "moduleReadyMs": 144,
          "rowsReadyMs": 1329,
          "rowsFrameMs": 1547
        },
        "warmOffline": {
          "moduleStartMs": 14,
          "input": [],
          "moduleReadyMs": 120,
          "rowsReadyMs": 587,
          "rowsFrameMs": 617
        },
        "edits": [
          {
            "localMs": 61,
            "frameMs": 82,
            "remoteObservedMs": 254.97535799996695,
            "serverConfirmedMs": 1065.137683000008
          },
          {
            "localMs": 53,
            "frameMs": 66,
            "remoteObservedMs": 235.68847599998116,
            "serverConfirmedMs": 1069.9509970000363
          },
          {
            "localMs": 56,
            "frameMs": 70,
            "remoteObservedMs": 241.07379799999762,
            "serverConfirmedMs": 1019.8360509999911
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018785,
        "projectionBefore": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 0
        },
        "projectionAfter": {
          "fullRebuilds": 2,
          "fullRowReads": 10000,
          "incrementalRowReads": 3
        }
      }
    ],
    "encodingImport": [
      {
        "mode": "snapshot",
        "repeat": 0,
        "bytes": 1018800,
        "importMs": 2,
        "projectionMs": 247,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 1,
        "bytes": 1018800,
        "importMs": 2,
        "projectionMs": 231,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 2,
        "bytes": 1018800,
        "importMs": 3,
        "projectionMs": 226,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 0,
        "bytes": 897531,
        "importMs": 274,
        "projectionMs": 123,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 1,
        "bytes": 897531,
        "importMs": 179,
        "projectionMs": 117,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 2,
        "bytes": 897531,
        "importMs": 183,
        "projectionMs": 131,
        "allRowsMatch": true
      }
    ],
    "projectionComparison": [
      {
        "mode": "full",
        "repeat": 0,
        "editAndProjectionMs": 272,
        "allRowsMatch": true,
        "indexedRows": 10000
      },
      {
        "mode": "full",
        "repeat": 1,
        "editAndProjectionMs": 230,
        "allRowsMatch": true,
        "indexedRows": 10000
      },
      {
        "mode": "full",
        "repeat": 2,
        "editAndProjectionMs": 222,
        "allRowsMatch": true,
        "indexedRows": 10000
      },
      {
        "mode": "full",
        "repeat": 3,
        "editAndProjectionMs": 219,
        "allRowsMatch": true,
        "indexedRows": 10000
      },
      {
        "mode": "full",
        "repeat": 4,
        "editAndProjectionMs": 219,
        "allRowsMatch": true,
        "indexedRows": 10000
      },
      {
        "mode": "incremental",
        "repeat": 0,
        "editAndProjectionMs": 6,
        "allRowsMatch": true,
        "projection": {
          "fullRebuilds": 1,
          "fullRowReads": 10000,
          "incrementalRowReads": 2
        }
      },
      {
        "mode": "incremental",
        "repeat": 1,
        "editAndProjectionMs": 7,
        "allRowsMatch": true,
        "projection": {
          "fullRebuilds": 1,
          "fullRowReads": 10000,
          "incrementalRowReads": 3
        }
      },
      {
        "mode": "incremental",
        "repeat": 2,
        "editAndProjectionMs": 7,
        "allRowsMatch": true,
        "projection": {
          "fullRebuilds": 1,
          "fullRowReads": 10000,
          "incrementalRowReads": 4
        }
      },
      {
        "mode": "incremental",
        "repeat": 3,
        "editAndProjectionMs": 5,
        "allRowsMatch": true,
        "projection": {
          "fullRebuilds": 1,
          "fullRowReads": 10000,
          "incrementalRowReads": 5
        }
      },
      {
        "mode": "incremental",
        "repeat": 4,
        "editAndProjectionMs": 6,
        "allRowsMatch": true,
        "projection": {
          "fullRebuilds": 1,
          "fullRowReads": 10000,
          "incrementalRowReads": 6
        }
      }
    ]
  }
]
```

## Windows WebKit

- 同じ実装のローカル実行。一万行の三回の反復と形式別import・表示更新の比較まで成功、約5.2分。
- ChromiumのLoro専用10件とは別の実行。同じポートのPlaywrightを同時には起動していない。
- revision=local。実機iPadやPWAの値ではない。

```json
{
  "engine": "loro",
  "browser": "webkit",
  "version": "26.6",
  "platform": "win32",
  "release": "10.0.26100",
  "cpu": "13th Gen Intel(R) Core(TM) i7-13800H",
  "cpuCount": 20,
  "memoryBytes": 68307476480,
  "node": "v24.19.0",
  "revision": "local",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 94,
        "input": [],
        "moduleReadyMs": 249,
        "rowsReadyMs": 19697,
        "rowsFrameMs": 19968
      },
      "coldB": {
        "moduleStartMs": 91,
        "input": [],
        "moduleReadyMs": 269,
        "rowsReadyMs": 24132,
        "rowsFrameMs": 24387
      },
      "warmOffline": {
        "moduleStartMs": 78,
        "input": [],
        "moduleReadyMs": 213,
        "rowsReadyMs": 1087,
        "rowsFrameMs": 1113
      },
      "edits": [
        {
          "localMs": 65,
          "frameMs": 79,
          "remoteObservedMs": 341.7303000000102,
          "serverConfirmedMs": 1111.0368000000017
        },
        {
          "localMs": 50,
          "frameMs": 62,
          "remoteObservedMs": 275.6837999999989,
          "serverConfirmedMs": 974.7517999999982
        },
        {
          "localMs": 61,
          "frameMs": 73,
          "remoteObservedMs": 277.4143999999942,
          "serverConfirmedMs": 943.9302999999927
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1019466,
      "projectionBefore": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      }
    },
    {
      "trial": 1,
      "coldA": {
        "moduleStartMs": 82,
        "input": [],
        "moduleReadyMs": 270,
        "rowsReadyMs": 20510,
        "rowsFrameMs": 20774
      },
      "coldB": {
        "moduleStartMs": 78,
        "input": [],
        "moduleReadyMs": 264,
        "rowsReadyMs": 20381,
        "rowsFrameMs": 20652
      },
      "warmOffline": {
        "moduleStartMs": 50,
        "input": [],
        "moduleReadyMs": 177,
        "rowsReadyMs": 887,
        "rowsFrameMs": 915
      },
      "edits": [
        {
          "localMs": 72,
          "frameMs": 87,
          "remoteObservedMs": 383.72510000001057,
          "serverConfirmedMs": 1103.1356000000087
        },
        {
          "localMs": 57,
          "frameMs": 68,
          "remoteObservedMs": 372.71759999998903,
          "serverConfirmedMs": 1044.0104999999894
        },
        {
          "localMs": 64,
          "frameMs": 79,
          "remoteObservedMs": 288.01579999999376,
          "serverConfirmedMs": 960.4668999999994
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1019813,
      "projectionBefore": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      }
    },
    {
      "trial": 2,
      "coldA": {
        "moduleStartMs": 76,
        "input": [],
        "moduleReadyMs": 235,
        "rowsReadyMs": 22166,
        "rowsFrameMs": 22443
      },
      "coldB": {
        "moduleStartMs": 66,
        "input": [],
        "moduleReadyMs": 210,
        "rowsReadyMs": 24580,
        "rowsFrameMs": 24828
      },
      "warmOffline": {
        "moduleStartMs": 66,
        "input": [],
        "moduleReadyMs": 196,
        "rowsReadyMs": 1030,
        "rowsFrameMs": 1065
      },
      "edits": [
        {
          "localMs": 77,
          "frameMs": 101,
          "remoteObservedMs": 366.35579999999027,
          "serverConfirmedMs": 1114.304300000018
        },
        {
          "localMs": 60,
          "frameMs": 71,
          "remoteObservedMs": 384.261599999998,
          "serverConfirmedMs": 1111.6016999999993
        },
        {
          "localMs": 73,
          "frameMs": 91,
          "remoteObservedMs": 315.99520000000484,
          "serverConfirmedMs": 1076.9790999999968
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1020047,
      "projectionBefore": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      }
    }
  ],
  "encodingImport": [
    {
      "mode": "snapshot",
      "repeat": 0,
      "bytes": 1019968,
      "importMs": 2,
      "projectionMs": 1142,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 1,
      "bytes": 1019968,
      "importMs": 33,
      "projectionMs": 1408,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 2,
      "bytes": 1019968,
      "importMs": 47,
      "projectionMs": 1952,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 0,
      "bytes": 899163,
      "importMs": 28710,
      "projectionMs": 133,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 1,
      "bytes": 899163,
      "importMs": 11901,
      "projectionMs": 115,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 2,
      "bytes": 899163,
      "importMs": 12110,
      "projectionMs": 127,
      "allRowsMatch": true
    }
  ],
  "projectionComparison": [
    {
      "mode": "full",
      "repeat": 0,
      "editAndProjectionMs": 264,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 1,
      "editAndProjectionMs": 274,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 2,
      "editAndProjectionMs": 2027,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 3,
      "editAndProjectionMs": 2041,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 4,
      "editAndProjectionMs": 2228,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "incremental",
      "repeat": 0,
      "editAndProjectionMs": 8,
      "allRowsMatch": true,
      "projection": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 2
      }
    },
    {
      "mode": "incremental",
      "repeat": 1,
      "editAndProjectionMs": 8,
      "allRowsMatch": true,
      "projection": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      }
    },
    {
      "mode": "incremental",
      "repeat": 2,
      "editAndProjectionMs": 6,
      "allRowsMatch": true,
      "projection": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 4
      }
    },
    {
      "mode": "incremental",
      "repeat": 3,
      "editAndProjectionMs": 5,
      "allRowsMatch": true,
      "projection": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 5
      }
    },
    {
      "mode": "incremental",
      "repeat": 4,
      "editAndProjectionMs": 5,
      "allRowsMatch": true,
      "projection": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 6
      }
    }
  ]
}
```
