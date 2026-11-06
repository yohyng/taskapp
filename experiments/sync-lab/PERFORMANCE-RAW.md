# 0.7.1の測定原票

合成データのみ。各samplesの3組と入力9回、Loroの形式別import各3回を省略せず保存する。

## 最終実行

- コード: 5d3140c48ed2b7ad05e6b8214fc3a6587c55214c
- [CI 40356020283](https://github.com/yohyng/taskapp/actions/runs/40356020283)、performance job 121688580142、6件成功・8.8分・再試行0。
- revisionはGitHub ActionsがcheckoutしたPRの合成merge commit。PRのheadと区別する。

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
    "memoryBytes": 16766414848,
    "node": "v24.21.0",
    "revision": "d72c6d92dbfbeb95af9ada482d3757e9eafaa5a6",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 50.39999999999418,
          "input": [],
          "moduleReadyMs": 106.89999999999418,
          "rowsReadyMs": 476.79999999998836,
          "rowsFrameMs": 502.69999999998254
        },
        "coldB": {
          "moduleStartMs": 31.699999999982538,
          "input": [],
          "moduleReadyMs": 67.60000000000582,
          "rowsReadyMs": 289.19999999998254,
          "rowsFrameMs": 317.19999999998254
        },
        "warmOffline": {
          "moduleStartMs": 22.10000000000582,
          "input": [],
          "moduleReadyMs": 30.60000000000582,
          "rowsReadyMs": 196.70000000001164,
          "rowsFrameMs": 202.89999999999418
        },
        "edits": [
          {
            "localMs": 24.29999999998836,
            "frameMs": 26.20000000001164,
            "remoteObservedMs": 41.192651000000296,
            "serverConfirmedMs": 1644.4443519999995
          },
          {
            "localMs": 26.5,
            "frameMs": 31.699999999982538,
            "remoteObservedMs": 32.4863949999999,
            "serverConfirmedMs": 1609.5654449999993
          },
          {
            "localMs": 28.199999999982538,
            "frameMs": 27.199999999982538,
            "remoteObservedMs": 34.91171899999972,
            "serverConfirmedMs": 1613.605313
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683060
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 58.60000000000582,
          "input": [],
          "moduleReadyMs": 109.70000000001164,
          "rowsReadyMs": 454.6000000000058,
          "rowsFrameMs": 479.8999999999942
        },
        "coldB": {
          "moduleStartMs": 31.39999999999418,
          "input": [],
          "moduleReadyMs": 73.60000000000582,
          "rowsReadyMs": 297.69999999998254,
          "rowsFrameMs": 323.6000000000058
        },
        "warmOffline": {
          "moduleStartMs": 26.5,
          "input": [],
          "moduleReadyMs": 35,
          "rowsReadyMs": 193,
          "rowsFrameMs": 199.70000000001164
        },
        "edits": [
          {
            "localMs": 20.199999999982538,
            "frameMs": 20.5,
            "remoteObservedMs": 34.026827000001504,
            "serverConfirmedMs": 1550.416070000003
          },
          {
            "localMs": 36.60000000000582,
            "frameMs": 33.29999999998836,
            "remoteObservedMs": 51.01757300000099,
            "serverConfirmedMs": 1588.6747969999997
          },
          {
            "localMs": 15.700000000011642,
            "frameMs": 14.89999999999418,
            "remoteObservedMs": 22.386020999998436,
            "serverConfirmedMs": 1610.2021209999984
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683169
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 38.79999999998836,
          "input": [],
          "moduleReadyMs": 87.89999999999418,
          "rowsReadyMs": 439.3999999999942,
          "rowsFrameMs": 467.5
        },
        "coldB": {
          "moduleStartMs": 30.20000000001164,
          "input": [],
          "moduleReadyMs": 61.10000000000582,
          "rowsReadyMs": 285,
          "rowsFrameMs": 308.80000000001746
        },
        "warmOffline": {
          "moduleStartMs": 20.20000000001164,
          "input": [],
          "moduleReadyMs": 27.79999999998836,
          "rowsReadyMs": 184.90000000002328,
          "rowsFrameMs": 191.90000000002328
        },
        "edits": [
          {
            "localMs": 18.399999999965075,
            "frameMs": 22.599999999976717,
            "remoteObservedMs": 28.563940000000002,
            "serverConfirmedMs": 1569.738096000001
          },
          {
            "localMs": 25.399999999965075,
            "frameMs": 23.20000000001164,
            "remoteObservedMs": 39.139783999999054,
            "serverConfirmedMs": 1577.907542999994
          },
          {
            "localMs": 14.899999999965075,
            "frameMs": 21.29999999998836,
            "remoteObservedMs": 21.149224000000686,
            "serverConfirmedMs": 1566.7887860000046
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683276
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
    "memoryBytes": 16766414848,
    "node": "v24.21.0",
    "revision": "d72c6d92dbfbeb95af9ada482d3757e9eafaa5a6",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 57.199999999953434,
          "input": [],
          "moduleReadyMs": 94.39999999996508,
          "rowsReadyMs": 2021.899999999965,
          "rowsFrameMs": 2053.2999999999884
        },
        "coldB": {
          "moduleStartMs": 40.79999999998836,
          "input": [],
          "moduleReadyMs": 68.59999999997672,
          "rowsReadyMs": 2072.5,
          "rowsFrameMs": 2093.0999999999767
        },
        "warmOffline": {
          "moduleStartMs": 27.100000000034925,
          "input": [],
          "moduleReadyMs": 40.600000000034925,
          "rowsReadyMs": 858.8000000000466,
          "rowsFrameMs": 883.7000000000116
        },
        "edits": [
          {
            "localMs": 1510.3000000000466,
            "frameMs": 20.900000000023283,
            "remoteObservedMs": 1308.293899999997,
            "serverConfirmedMs": 2945.364201999997
          },
          {
            "localMs": 1271.2000000000116,
            "frameMs": 24.600000000034925,
            "remoteObservedMs": 1294.1403980000032,
            "serverConfirmedMs": 2395.230331999999
          },
          {
            "localMs": 1302.0999999999767,
            "frameMs": 28,
            "remoteObservedMs": 1295.390741000003,
            "serverConfirmedMs": 2354.6670180000074
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855636
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 38.70000000001164,
          "input": [],
          "moduleReadyMs": 68.10000000003492,
          "rowsReadyMs": 2003.8000000000466,
          "rowsFrameMs": 2030.8000000000466
        },
        "coldB": {
          "moduleStartMs": 30.70000000001164,
          "input": [],
          "moduleReadyMs": 53.09999999997672,
          "rowsReadyMs": 1933.0999999999767,
          "rowsFrameMs": 1954.2999999999884
        },
        "warmOffline": {
          "moduleStartMs": 27.899999999965075,
          "input": [],
          "moduleReadyMs": 41.399999999965075,
          "rowsReadyMs": 858.7999999999884,
          "rowsFrameMs": 880.5
        },
        "edits": [
          {
            "localMs": 1215.7999999999884,
            "frameMs": 24.899999999965075,
            "remoteObservedMs": 1303.7079590000067,
            "serverConfirmedMs": 2357.849914999999
          },
          {
            "localMs": 1171.399999999965,
            "frameMs": 20.70000000001164,
            "remoteObservedMs": 1323.074808999998,
            "serverConfirmedMs": 2216.1929910000035
          },
          {
            "localMs": 1081.1999999999534,
            "frameMs": 21.599999999976717,
            "remoteObservedMs": 1295.5043219999934,
            "serverConfirmedMs": 2497.4103969999996
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855692
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 37.899999999965075,
          "input": [],
          "moduleReadyMs": 71.89999999996508,
          "rowsReadyMs": 2026,
          "rowsFrameMs": 2054.1999999999534
        },
        "coldB": {
          "moduleStartMs": 30.29999999998836,
          "input": [],
          "moduleReadyMs": 51.79999999998836,
          "rowsReadyMs": 1949.7000000000116,
          "rowsFrameMs": 1968.100000000035
        },
        "warmOffline": {
          "moduleStartMs": 28.29999999998836,
          "input": [],
          "moduleReadyMs": 37.40000000002328,
          "rowsReadyMs": 823.7999999999884,
          "rowsFrameMs": 843.2000000000116
        },
        "edits": [
          {
            "localMs": 1175.7000000000116,
            "frameMs": 29.29999999998836,
            "remoteObservedMs": 1311.2409279999993,
            "serverConfirmedMs": 2364.086743000007
          },
          {
            "localMs": 1119,
            "frameMs": 29.599999999976717,
            "remoteObservedMs": 1293.3071270000073,
            "serverConfirmedMs": 2097.005937000009
          },
          {
            "localMs": 1172.9000000000233,
            "frameMs": 27.900000000023283,
            "remoteObservedMs": 1306.3301550000033,
            "serverConfirmedMs": 2287.227534999998
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
    "memoryBytes": 16766414848,
    "node": "v24.21.0",
    "revision": "d72c6d92dbfbeb95af9ada482d3757e9eafaa5a6",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 39,
          "input": [],
          "moduleReadyMs": 122.59999999997672,
          "rowsReadyMs": 1099.0999999999767,
          "rowsFrameMs": 1282.899999999965
        },
        "coldB": {
          "moduleStartMs": 33.300000000046566,
          "input": [],
          "moduleReadyMs": 117.5,
          "rowsReadyMs": 1192.5,
          "rowsFrameMs": 1422.2000000000116
        },
        "warmOffline": {
          "moduleStartMs": 36.20000000001164,
          "input": [],
          "moduleReadyMs": 81.20000000001164,
          "rowsReadyMs": 446.8999999999651,
          "rowsFrameMs": 682.7000000000116
        },
        "edits": [
          {
            "localMs": 342.4000000000233,
            "frameMs": 205.10000000003492,
            "remoteObservedMs": 751.8592309999804,
            "serverConfirmedMs": 1932.8731029999908
          },
          {
            "localMs": 343.20000000001164,
            "frameMs": 189,
            "remoteObservedMs": 694.8780470000056,
            "serverConfirmedMs": 1861.460745999997
          },
          {
            "localMs": 406.3999999999651,
            "frameMs": 283.3999999999651,
            "remoteObservedMs": 1218.0049659999786,
            "serverConfirmedMs": 2269.743189999979
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1017563
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 40.5,
          "input": [],
          "moduleReadyMs": 140.79999999998836,
          "rowsReadyMs": 1158.9000000000233,
          "rowsFrameMs": 1338.2999999999884
        },
        "coldB": {
          "moduleStartMs": 44,
          "input": [],
          "moduleReadyMs": 115.5,
          "rowsReadyMs": 1280.7000000000116,
          "rowsFrameMs": 1475.5
        },
        "warmOffline": {
          "moduleStartMs": 18.79999999998836,
          "input": [],
          "moduleReadyMs": 70.09999999997672,
          "rowsReadyMs": 394,
          "rowsFrameMs": 617.3999999999651
        },
        "edits": [
          {
            "localMs": 516.3000000000466,
            "frameMs": 373.80000000004657,
            "remoteObservedMs": 1161.2264549999963,
            "serverConfirmedMs": 2343.7587299999723
          },
          {
            "localMs": 323,
            "frameMs": 196.20000000001164,
            "remoteObservedMs": 622.9073689999932,
            "serverConfirmedMs": 1685.2550599999959
          },
          {
            "localMs": 393.29999999998836,
            "frameMs": 236.40000000002328,
            "remoteObservedMs": 731.1401900000055,
            "serverConfirmedMs": 1888.0898970000271
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1017818
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 41,
          "input": [],
          "moduleReadyMs": 111.89999999996508,
          "rowsReadyMs": 1176.899999999965,
          "rowsFrameMs": 1379.899999999965
        },
        "coldB": {
          "moduleStartMs": 30.29999999998836,
          "input": [],
          "moduleReadyMs": 94.10000000003492,
          "rowsReadyMs": 1262.5,
          "rowsFrameMs": 1468
        },
        "warmOffline": {
          "moduleStartMs": 52.5,
          "input": [],
          "moduleReadyMs": 97.29999999998836,
          "rowsReadyMs": 406.29999999998836,
          "rowsFrameMs": 613.2999999999884
        },
        "edits": [
          {
            "localMs": 416.0999999999767,
            "frameMs": 203.09999999997672,
            "remoteObservedMs": 735.9618119999941,
            "serverConfirmedMs": 1915.3969939999806
          },
          {
            "localMs": 424.5999999999767,
            "frameMs": 218.5,
            "remoteObservedMs": 778.0420570000133,
            "serverConfirmedMs": 2042.5213520000107
          },
          {
            "localMs": 299,
            "frameMs": 174.59999999997672,
            "remoteObservedMs": 653.6334539999953,
            "serverConfirmedMs": 1833.476821999997
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018066
      }
    ],
    "encodingImport": [
      {
        "mode": "snapshot",
        "repeat": 0,
        "bytes": 1017991,
        "importMs": 1,
        "projectionMs": 199.89999999996508,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 1,
        "bytes": 1017991,
        "importMs": 1.7000000000116415,
        "projectionMs": 199.79999999998836,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 2,
        "bytes": 1017991,
        "importMs": 1.6000000000349246,
        "projectionMs": 271.20000000001164,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 0,
        "bytes": 896622,
        "importMs": 193.5,
        "projectionMs": 98.79999999998836,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 1,
        "bytes": 896622,
        "importMs": 172.29999999998836,
        "projectionMs": 99.79999999998836,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 2,
        "bytes": 896622,
        "importMs": 198.40000000002328,
        "projectionMs": 181,
        "allRowsMatch": true
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
    "memoryBytes": 16766414848,
    "node": "v24.21.0",
    "revision": "d72c6d92dbfbeb95af9ada482d3757e9eafaa5a6",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 47,
          "input": [],
          "moduleReadyMs": 117,
          "rowsReadyMs": 516,
          "rowsFrameMs": 550
        },
        "coldB": {
          "moduleStartMs": 25,
          "input": [],
          "moduleReadyMs": 64,
          "rowsReadyMs": 334,
          "rowsFrameMs": 368
        },
        "warmOffline": {
          "moduleStartMs": 18,
          "input": [],
          "moduleReadyMs": 47,
          "rowsReadyMs": 280,
          "rowsFrameMs": 310
        },
        "edits": [
          {
            "localMs": 39,
            "frameMs": 120,
            "remoteObservedMs": 44.38571299999967,
            "serverConfirmedMs": 770.0385989999995
          },
          {
            "localMs": 33,
            "frameMs": 46,
            "remoteObservedMs": 37.621477000000596,
            "serverConfirmedMs": 1453.9398579999997
          },
          {
            "localMs": 30,
            "frameMs": 49,
            "remoteObservedMs": 30.083055999999488,
            "serverConfirmedMs": 1419.6321609999995
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683379
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 39,
          "input": [],
          "moduleReadyMs": 134,
          "rowsReadyMs": 552,
          "rowsFrameMs": 592
        },
        "coldB": {
          "moduleStartMs": 24,
          "input": [],
          "moduleReadyMs": 65,
          "rowsReadyMs": 322,
          "rowsFrameMs": 357
        },
        "warmOffline": {
          "moduleStartMs": 16,
          "input": [],
          "moduleReadyMs": 37,
          "rowsReadyMs": 244,
          "rowsFrameMs": 280
        },
        "edits": [
          {
            "localMs": 41,
            "frameMs": 56,
            "remoteObservedMs": 41.174699999999575,
            "serverConfirmedMs": 1426.127246
          },
          {
            "localMs": 31,
            "frameMs": 47,
            "remoteObservedMs": 28.73889500000223,
            "serverConfirmedMs": 1449.202835
          },
          {
            "localMs": 34,
            "frameMs": 48,
            "remoteObservedMs": 36.91923900000256,
            "serverConfirmedMs": 1404.4596039999997
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683482
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 42,
          "input": [],
          "moduleReadyMs": 92,
          "rowsReadyMs": 519,
          "rowsFrameMs": 555
        },
        "coldB": {
          "moduleStartMs": 23,
          "input": [],
          "moduleReadyMs": 61,
          "rowsReadyMs": 332,
          "rowsFrameMs": 370
        },
        "warmOffline": {
          "moduleStartMs": 14,
          "input": [],
          "moduleReadyMs": 36,
          "rowsReadyMs": 264,
          "rowsFrameMs": 306
        },
        "edits": [
          {
            "localMs": 37,
            "frameMs": 58,
            "remoteObservedMs": 37.69817800000601,
            "serverConfirmedMs": 1486.9952830000038
          },
          {
            "localMs": 34,
            "frameMs": 54,
            "remoteObservedMs": 36.79140899999766,
            "serverConfirmedMs": 1415.522653
          },
          {
            "localMs": 38,
            "frameMs": 42,
            "remoteObservedMs": 32.2999770000024,
            "serverConfirmedMs": 1457.0296790000066
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1683585
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
    "memoryBytes": 16766414848,
    "node": "v24.21.0",
    "revision": "d72c6d92dbfbeb95af9ada482d3757e9eafaa5a6",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 40,
          "input": [],
          "moduleReadyMs": 70,
          "rowsReadyMs": 3864,
          "rowsFrameMs": 3925
        },
        "coldB": {
          "moduleStartMs": 46,
          "input": [],
          "moduleReadyMs": 72,
          "rowsReadyMs": 5513,
          "rowsFrameMs": 5568
        },
        "warmOffline": {
          "moduleStartMs": 14,
          "input": [],
          "moduleReadyMs": 32,
          "rowsReadyMs": 1039,
          "rowsFrameMs": 1068
        },
        "edits": [
          {
            "localMs": 2626,
            "frameMs": 51,
            "remoteObservedMs": 2355.1177600000083,
            "serverConfirmedMs": 4697.717400000009
          },
          {
            "localMs": 5251,
            "frameMs": 38,
            "remoteObservedMs": 2330.4223899999924,
            "serverConfirmedMs": 7842.389545999991
          },
          {
            "localMs": 4381,
            "frameMs": 31,
            "remoteObservedMs": 3326.9631200000003,
            "serverConfirmedMs": 5811.145306999999
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855798
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 35,
          "input": [],
          "moduleReadyMs": 74,
          "rowsReadyMs": 3928,
          "rowsFrameMs": 3978
        },
        "coldB": {
          "moduleStartMs": 66,
          "input": [],
          "moduleReadyMs": 115,
          "rowsReadyMs": 6156,
          "rowsFrameMs": 6213
        },
        "warmOffline": {
          "moduleStartMs": 26,
          "input": [],
          "moduleReadyMs": 44,
          "rowsReadyMs": 1014,
          "rowsFrameMs": 1049
        },
        "edits": [
          {
            "localMs": 3333,
            "frameMs": 88,
            "remoteObservedMs": 2873.63798900001,
            "serverConfirmedMs": 6620.030224000002
          },
          {
            "localMs": 6537,
            "frameMs": 32,
            "remoteObservedMs": 3365.8888499999885,
            "serverConfirmedMs": 9532.399099000002
          },
          {
            "localMs": 5311,
            "frameMs": 32,
            "remoteObservedMs": 3839.24276199998,
            "serverConfirmedMs": 7069.964273999998
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855848
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 47,
          "input": [],
          "moduleReadyMs": 76,
          "rowsReadyMs": 3911,
          "rowsFrameMs": 3964
        },
        "coldB": {
          "moduleStartMs": 42,
          "input": [],
          "moduleReadyMs": 90,
          "rowsReadyMs": 5376,
          "rowsFrameMs": 5432
        },
        "warmOffline": {
          "moduleStartMs": 16,
          "input": [],
          "moduleReadyMs": 37,
          "rowsReadyMs": 1007,
          "rowsFrameMs": 1048
        },
        "edits": [
          {
            "localMs": 2518,
            "frameMs": 82,
            "remoteObservedMs": 2349.457495999988,
            "serverConfirmedMs": 4357.086544999998
          },
          {
            "localMs": 6511,
            "frameMs": 22,
            "remoteObservedMs": 3847.8051510000078,
            "serverConfirmedMs": 8631.978746000008
          },
          {
            "localMs": 3955,
            "frameMs": 33,
            "remoteObservedMs": 2812.992753999977,
            "serverConfirmedMs": 5386.971840999991
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
    "memoryBytes": 16766414848,
    "node": "v24.21.0",
    "revision": "d72c6d92dbfbeb95af9ada482d3757e9eafaa5a6",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 47,
          "input": [],
          "moduleReadyMs": 177,
          "rowsReadyMs": 1182,
          "rowsFrameMs": 1748
        },
        "coldB": {
          "moduleStartMs": 22,
          "input": [],
          "moduleReadyMs": 146,
          "rowsReadyMs": 1277,
          "rowsFrameMs": 1871
        },
        "warmOffline": {
          "moduleStartMs": 11,
          "input": [],
          "moduleReadyMs": 140,
          "rowsReadyMs": 648,
          "rowsFrameMs": 898
        },
        "edits": [
          {
            "localMs": 481,
            "frameMs": 482,
            "remoteObservedMs": 1249.0076289999997,
            "serverConfirmedMs": 2135.805941999977
          },
          {
            "localMs": 345,
            "frameMs": 345,
            "remoteObservedMs": 655.0677549999964,
            "serverConfirmedMs": 2710.5506469999964
          },
          {
            "localMs": 384,
            "frameMs": 385,
            "remoteObservedMs": 1180.6081379999814,
            "serverConfirmedMs": 2119.097730999987
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018292
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 33,
          "input": [],
          "moduleReadyMs": 183,
          "rowsReadyMs": 1269,
          "rowsFrameMs": 1802
        },
        "coldB": {
          "moduleStartMs": 26,
          "input": [],
          "moduleReadyMs": 142,
          "rowsReadyMs": 1361,
          "rowsFrameMs": 1930
        },
        "warmOffline": {
          "moduleStartMs": 29,
          "input": [],
          "moduleReadyMs": 185,
          "rowsReadyMs": 556,
          "rowsFrameMs": 856
        },
        "edits": [
          {
            "localMs": 813,
            "frameMs": 611,
            "remoteObservedMs": 1185.4797890000045,
            "serverConfirmedMs": 2258.314989000006
          },
          {
            "localMs": 397,
            "frameMs": 398,
            "remoteObservedMs": 773.3516800000216,
            "serverConfirmedMs": 1804.408339000016
          },
          {
            "localMs": 411,
            "frameMs": 412,
            "remoteObservedMs": 722.9729119999683,
            "serverConfirmedMs": 2376.6372020000126
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018541
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 34,
          "input": [],
          "moduleReadyMs": 175,
          "rowsReadyMs": 1198,
          "rowsFrameMs": 1771
        },
        "coldB": {
          "moduleStartMs": 29,
          "input": [],
          "moduleReadyMs": 159,
          "rowsReadyMs": 1253,
          "rowsFrameMs": 1833
        },
        "warmOffline": {
          "moduleStartMs": 16,
          "input": [],
          "moduleReadyMs": 110,
          "rowsReadyMs": 493,
          "rowsFrameMs": 846
        },
        "edits": [
          {
            "localMs": 438,
            "frameMs": 439,
            "remoteObservedMs": 768.4602259999956,
            "serverConfirmedMs": 1788.2099230000167
          },
          {
            "localMs": 346,
            "frameMs": 346,
            "remoteObservedMs": 692.9853410000214,
            "serverConfirmedMs": 1772.0136659999844
          },
          {
            "localMs": 388,
            "frameMs": 388,
            "remoteObservedMs": 1020.0839609999675,
            "serverConfirmedMs": 2041.323285999999
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018765
      }
    ],
    "encodingImport": [
      {
        "mode": "snapshot",
        "repeat": 0,
        "bytes": 1018773,
        "importMs": 1,
        "projectionMs": 222,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 1,
        "bytes": 1018773,
        "importMs": 2,
        "projectionMs": 232,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 2,
        "bytes": 1018773,
        "importMs": 6,
        "projectionMs": 201,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 0,
        "bytes": 897531,
        "importMs": 291,
        "projectionMs": 126,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 1,
        "bytes": 897531,
        "importMs": 179,
        "projectionMs": 119,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 2,
        "bytes": 897531,
        "importMs": 174,
        "projectionMs": 129,
        "allRowsMatch": true
      }
    ]
  }
]
```

## 0.7.0の先行実行

- コード: 88dcef9d7821f51baa014698e15b75bf96c2736e
- [CI 40354785558](https://github.com/yohyng/taskapp/actions/runs/40354785558)、performance job 121684220141、6件成功・5.4分・再試行0。
- 同じアプリ経路と測定条件。0.7.1は測定後の全行照合を強め、環境情報も追加した。
- ホストCPUが違うため、コードによる速度改善として比較しない。

```json
[
  {
    "engine": "yjs",
    "browser": "chromium",
    "version": "153.0.8010.12",
    "platform": "linux",
    "cpu": "AMD EPYC 9V45 96-Core Processor",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 41.69999999999709,
          "input": [],
          "moduleReadyMs": 85.39999999999418,
          "rowsReadyMs": 340.59999999999127,
          "rowsFrameMs": 360.3999999999942
        },
        "coldB": {
          "moduleStartMs": 22,
          "input": [],
          "moduleReadyMs": 71.69999999999709,
          "rowsReadyMs": 221,
          "rowsFrameMs": 239.10000000000582
        },
        "warmOffline": {
          "moduleStartMs": 15,
          "input": [],
          "moduleReadyMs": 21,
          "rowsReadyMs": 145.40000000000873,
          "rowsFrameMs": 150.5
        },
        "edits": [
          {
            "localMs": 19,
            "frameMs": 24.89999999999418,
            "remoteObservedMs": 28.446398000000045,
            "serverConfirmedMs": 1061.952577
          },
          {
            "localMs": 19.5,
            "frameMs": 29.80000000000291,
            "remoteObservedMs": 32.25681999999961,
            "serverConfirmedMs": 1068.3086210000001
          },
          {
            "localMs": 16.10000000000582,
            "frameMs": 24.80000000000291,
            "remoteObservedMs": 23.99145800000042,
            "serverConfirmedMs": 1064.690216
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1623056
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 37.60000000000582,
          "input": [],
          "moduleReadyMs": 64.30000000000291,
          "rowsReadyMs": 282.90000000000873,
          "rowsFrameMs": 300.1000000000058
        },
        "coldB": {
          "moduleStartMs": 27,
          "input": [],
          "moduleReadyMs": 50.30000000000291,
          "rowsReadyMs": 202.60000000000582,
          "rowsFrameMs": 221.60000000000582
        },
        "warmOffline": {
          "moduleStartMs": 17.5,
          "input": [],
          "moduleReadyMs": 23.39999999999418,
          "rowsReadyMs": 128.5,
          "rowsFrameMs": 145.8000000000029
        },
        "edits": [
          {
            "localMs": 23.60000000000582,
            "frameMs": 22.20000000001164,
            "remoteObservedMs": 31.91526200000044,
            "serverConfirmedMs": 1018.8803710000011
          },
          {
            "localMs": 19.40000000000873,
            "frameMs": 32.19999999999709,
            "remoteObservedMs": 26.68581400000039,
            "serverConfirmedMs": 1038.8648009999997
          },
          {
            "localMs": 13.69999999999709,
            "frameMs": 22.39999999999418,
            "remoteObservedMs": 19.395360000000437,
            "serverConfirmedMs": 1011.4868409999999
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1623165
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 30.59999999999127,
          "input": [],
          "moduleReadyMs": 62.19999999999709,
          "rowsReadyMs": 293.59999999999127,
          "rowsFrameMs": 310
        },
        "coldB": {
          "moduleStartMs": 24.69999999999709,
          "input": [],
          "moduleReadyMs": 46.09999999999127,
          "rowsReadyMs": 195.5,
          "rowsFrameMs": 213.29999999998836
        },
        "warmOffline": {
          "moduleStartMs": 27.69999999999709,
          "input": [],
          "moduleReadyMs": 34.30000000000291,
          "rowsReadyMs": 140.8000000000029,
          "rowsFrameMs": 146.3000000000029
        },
        "edits": [
          {
            "localMs": 26.90000000000873,
            "frameMs": 26.20000000001164,
            "remoteObservedMs": 29.49118599999929,
            "serverConfirmedMs": 1068.0541279999998
          },
          {
            "localMs": 20.70000000001164,
            "frameMs": 24.20000000001164,
            "remoteObservedMs": 31.32429399999819,
            "serverConfirmedMs": 1004.243273
          },
          {
            "localMs": 13.5,
            "frameMs": 12.69999999999709,
            "remoteObservedMs": 14.540755000001809,
            "serverConfirmedMs": 1057.1967010000008
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1623273
      }
    ]
  },
  {
    "engine": "powersync",
    "browser": "chromium",
    "version": "153.0.8010.12",
    "platform": "linux",
    "cpu": "AMD EPYC 9V45 96-Core Processor",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 27.90000000000873,
          "input": [],
          "moduleReadyMs": 48.70000000001164,
          "rowsReadyMs": 1061.2000000000116,
          "rowsFrameMs": 1093.5
        },
        "coldB": {
          "moduleStartMs": 23.10000000000582,
          "input": [],
          "moduleReadyMs": 37.80000000000291,
          "rowsReadyMs": 1153.6000000000058,
          "rowsFrameMs": 1172.6000000000058
        },
        "warmOffline": {
          "moduleStartMs": 18.70000000001164,
          "input": [],
          "moduleReadyMs": 27.10000000000582,
          "rowsReadyMs": 477.80000000001746,
          "rowsFrameMs": 496.1000000000058
        },
        "edits": [
          {
            "localMs": 826.2000000000116,
            "frameMs": 27.10000000000582,
            "remoteObservedMs": 791.387493000002,
            "serverConfirmedMs": 1487.6935680000024
          },
          {
            "localMs": 387.20000000001164,
            "frameMs": 5.600000000005821,
            "remoteObservedMs": 1288.6264349999983,
            "serverConfirmedMs": 1898.3703139999998
          },
          {
            "localMs": 304.30000000001746,
            "frameMs": 18.900000000023283,
            "remoteObservedMs": 1289.6199419999975,
            "serverConfirmedMs": 1878.588119
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855636
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 32.89999999999418,
          "input": [],
          "moduleReadyMs": 50.5,
          "rowsReadyMs": 1123.8999999999942,
          "rowsFrameMs": 1146.3999999999942
        },
        "coldB": {
          "moduleStartMs": 22,
          "input": [],
          "moduleReadyMs": 37.5,
          "rowsReadyMs": 1123.5,
          "rowsFrameMs": 1147.4000000000233
        },
        "warmOffline": {
          "moduleStartMs": 23.10000000000582,
          "input": [],
          "moduleReadyMs": 29.60000000000582,
          "rowsReadyMs": 521.2000000000116,
          "rowsFrameMs": 542.7000000000116
        },
        "edits": [
          {
            "localMs": 651.8999999999942,
            "frameMs": 29.89999999999418,
            "remoteObservedMs": 789.6704199999949,
            "serverConfirmedMs": 1483.7266339999987
          },
          {
            "localMs": 317.5,
            "frameMs": 12.60000000000582,
            "remoteObservedMs": 1284.630204000001,
            "serverConfirmedMs": 1769.947079000005
          },
          {
            "localMs": 313.3999999999942,
            "frameMs": 4.899999999994179,
            "remoteObservedMs": 1293.2703829999955,
            "serverConfirmedMs": 1777.0539629999985
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855692
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 31.70000000001164,
          "input": [],
          "moduleReadyMs": 52.70000000001164,
          "rowsReadyMs": 1112.1000000000058,
          "rowsFrameMs": 1145
        },
        "coldB": {
          "moduleStartMs": 20.79999999998836,
          "input": [],
          "moduleReadyMs": 34.39999999999418,
          "rowsReadyMs": 1111,
          "rowsFrameMs": 1135.3999999999942
        },
        "warmOffline": {
          "moduleStartMs": 21.89999999999418,
          "input": [],
          "moduleReadyMs": 35.79999999998836,
          "rowsReadyMs": 485,
          "rowsFrameMs": 502.69999999998254
        },
        "edits": [
          {
            "localMs": 668.1000000000058,
            "frameMs": 18.10000000000582,
            "remoteObservedMs": 788.283832000001,
            "serverConfirmedMs": 1378.2382780000044
          },
          {
            "localMs": 283.8999999999942,
            "frameMs": 2.5,
            "remoteObservedMs": 1286.5413719999924,
            "serverConfirmedMs": 1889.7088019999937
          },
          {
            "localMs": 294.8999999999942,
            "frameMs": 10.89999999999418,
            "remoteObservedMs": 1289.9123790000012,
            "serverConfirmedMs": 1969.2534100000048
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
    "cpu": "AMD EPYC 9V45 96-Core Processor",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 31.79999999998836,
          "input": [],
          "moduleReadyMs": 84.79999999998836,
          "rowsReadyMs": 729.5,
          "rowsFrameMs": 858.3999999999942
        },
        "coldB": {
          "moduleStartMs": 27.89999999999418,
          "input": [],
          "moduleReadyMs": 82.20000000001164,
          "rowsReadyMs": 751.6000000000058,
          "rowsFrameMs": 875.5
        },
        "warmOffline": {
          "moduleStartMs": 42.10000000000582,
          "input": [],
          "moduleReadyMs": 86.20000000001164,
          "rowsReadyMs": 291.29999999998836,
          "rowsFrameMs": 397.1000000000058
        },
        "edits": [
          {
            "localMs": 227,
            "frameMs": 141.80000000001746,
            "remoteObservedMs": 486.19051000000036,
            "serverConfirmedMs": 1169.3251170000003
          },
          {
            "localMs": 301,
            "frameMs": 137.20000000001164,
            "remoteObservedMs": 609.1842579999939,
            "serverConfirmedMs": 1277.5114949999988
          },
          {
            "localMs": 258.8999999999942,
            "frameMs": 120.20000000001164,
            "remoteObservedMs": 555.8868840000068,
            "serverConfirmedMs": 1252.8480969999946
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1017576
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 33.20000000001164,
          "input": [],
          "moduleReadyMs": 79.10000000000582,
          "rowsReadyMs": 721.9000000000233,
          "rowsFrameMs": 839.8000000000175
        },
        "coldB": {
          "moduleStartMs": 25.89999999999418,
          "input": [],
          "moduleReadyMs": 70.39999999999418,
          "rowsReadyMs": 779.8999999999942,
          "rowsFrameMs": 909.6999999999825
        },
        "warmOffline": {
          "moduleStartMs": 44.20000000001164,
          "input": [],
          "moduleReadyMs": 73.10000000000582,
          "rowsReadyMs": 256.4000000000233,
          "rowsFrameMs": 362.6000000000058
        },
        "edits": [
          {
            "localMs": 235.60000000000582,
            "frameMs": 146.70000000001164,
            "remoteObservedMs": 433.4888510000019,
            "serverConfirmedMs": 1145.0001090000005
          },
          {
            "localMs": 230,
            "frameMs": 108.5,
            "remoteObservedMs": 587.5271350000112,
            "serverConfirmedMs": 1250.921297000008
          },
          {
            "localMs": 294.19999999998254,
            "frameMs": 152.39999999999418,
            "remoteObservedMs": 594.6885110000003,
            "serverConfirmedMs": 1222.3010280000017
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1017850
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 33.80000000001746,
          "input": [],
          "moduleReadyMs": 80.80000000001746,
          "rowsReadyMs": 734.2000000000116,
          "rowsFrameMs": 841.4000000000233
        },
        "coldB": {
          "moduleStartMs": 27.699999999982538,
          "input": [],
          "moduleReadyMs": 74.79999999998836,
          "rowsReadyMs": 766.3999999999942,
          "rowsFrameMs": 882.2999999999884
        },
        "warmOffline": {
          "moduleStartMs": 14.099999999976717,
          "input": [],
          "moduleReadyMs": 42.5,
          "rowsReadyMs": 286.0999999999767,
          "rowsFrameMs": 398.69999999998254
        },
        "edits": [
          {
            "localMs": 268,
            "frameMs": 172.69999999998254,
            "remoteObservedMs": 535.8467630000087,
            "serverConfirmedMs": 1224.2707309999969
          },
          {
            "localMs": 263.5,
            "frameMs": 137.40000000002328,
            "remoteObservedMs": 685.0072949999885,
            "serverConfirmedMs": 1430.0105699999986
          },
          {
            "localMs": 224.29999999998836,
            "frameMs": 133.79999999998836,
            "remoteObservedMs": 642.7791140000045,
            "serverConfirmedMs": 1364.5733990000008
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018070
      }
    ],
    "encodingImport": [
      {
        "mode": "snapshot",
        "repeat": 0,
        "bytes": 1017999,
        "importMs": 0.8000000000174623,
        "projectionMs": 178.5,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 1,
        "bytes": 1017999,
        "importMs": 1.2000000000116415,
        "projectionMs": 130.60000000000582,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 2,
        "bytes": 1017999,
        "importMs": 1.3999999999941792,
        "projectionMs": 126.30000000001746,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 0,
        "bytes": 896622,
        "importMs": 127,
        "projectionMs": 128.79999999998836,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 1,
        "bytes": 896622,
        "importMs": 118.60000000000582,
        "projectionMs": 77.80000000001746,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 2,
        "bytes": 896622,
        "importMs": 120.20000000001164,
        "projectionMs": 74.29999999998836,
        "allRowsMatch": true
      }
    ]
  },
  {
    "engine": "yjs",
    "browser": "webkit",
    "version": "26.6",
    "platform": "linux",
    "cpu": "AMD EPYC 9V45 96-Core Processor",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 36,
          "input": [],
          "moduleReadyMs": 64,
          "rowsReadyMs": 340,
          "rowsFrameMs": 367
        },
        "coldB": {
          "moduleStartMs": 32,
          "input": [],
          "moduleReadyMs": 61,
          "rowsReadyMs": 204,
          "rowsFrameMs": 230
        },
        "warmOffline": {
          "moduleStartMs": 12,
          "input": [],
          "moduleReadyMs": 26,
          "rowsReadyMs": 158,
          "rowsFrameMs": 178
        },
        "edits": [
          {
            "localMs": 26,
            "frameMs": 76,
            "remoteObservedMs": 29.980638,
            "serverConfirmedMs": 473.1250799999998
          },
          {
            "localMs": 29,
            "frameMs": 33,
            "remoteObservedMs": 28.696896999999808,
            "serverConfirmedMs": 906.6729009999999
          },
          {
            "localMs": 28,
            "frameMs": 34,
            "remoteObservedMs": 26.859397000000172,
            "serverConfirmedMs": 890.5918170000004
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1623375
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 27,
          "input": [],
          "moduleReadyMs": 76,
          "rowsReadyMs": 318,
          "rowsFrameMs": 345
        },
        "coldB": {
          "moduleStartMs": 17,
          "input": [],
          "moduleReadyMs": 43,
          "rowsReadyMs": 202,
          "rowsFrameMs": 227
        },
        "warmOffline": {
          "moduleStartMs": 10,
          "input": [],
          "moduleReadyMs": 22,
          "rowsReadyMs": 157,
          "rowsFrameMs": 196
        },
        "edits": [
          {
            "localMs": 24,
            "frameMs": 36,
            "remoteObservedMs": 26.89214500000162,
            "serverConfirmedMs": 962.3321560000004
          },
          {
            "localMs": 32,
            "frameMs": 35,
            "remoteObservedMs": 27.45496600000115,
            "serverConfirmedMs": 875.8038610000021
          },
          {
            "localMs": 31,
            "frameMs": 35,
            "remoteObservedMs": 30.297654999998485,
            "serverConfirmedMs": 856.0435029999971
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1623478
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 46,
          "input": [],
          "moduleReadyMs": 90,
          "rowsReadyMs": 339,
          "rowsFrameMs": 363
        },
        "coldB": {
          "moduleStartMs": 29,
          "input": [],
          "moduleReadyMs": 66,
          "rowsReadyMs": 217,
          "rowsFrameMs": 241
        },
        "warmOffline": {
          "moduleStartMs": 10,
          "input": [],
          "moduleReadyMs": 21,
          "rowsReadyMs": 159,
          "rowsFrameMs": 177
        },
        "edits": [
          {
            "localMs": 22,
            "frameMs": 37,
            "remoteObservedMs": 28.075166999999055,
            "serverConfirmedMs": 883.9742279999991
          },
          {
            "localMs": 27,
            "frameMs": 31,
            "remoteObservedMs": 28.615725999999995,
            "serverConfirmedMs": 836.4826719999983
          },
          {
            "localMs": 28,
            "frameMs": 29,
            "remoteObservedMs": 22.942645999999513,
            "serverConfirmedMs": 834.4824430000008
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1623580
      }
    ]
  },
  {
    "engine": "powersync",
    "browser": "webkit",
    "version": "26.6",
    "platform": "linux",
    "cpu": "AMD EPYC 9V45 96-Core Processor",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 26,
          "input": [],
          "moduleReadyMs": 72,
          "rowsReadyMs": 2330,
          "rowsFrameMs": 2361
        },
        "coldB": {
          "moduleStartMs": 39,
          "input": [],
          "moduleReadyMs": 72,
          "rowsReadyMs": 3852,
          "rowsFrameMs": 3890
        },
        "warmOffline": {
          "moduleStartMs": 29,
          "input": [],
          "moduleReadyMs": 58,
          "rowsReadyMs": 863,
          "rowsFrameMs": 905
        },
        "edits": [
          {
            "localMs": 1521,
            "frameMs": 47,
            "remoteObservedMs": 1826.2641530000037,
            "serverConfirmedMs": 3013.127367000001
          },
          {
            "localMs": 1600,
            "frameMs": 31,
            "remoteObservedMs": 1315.4159079999954,
            "serverConfirmedMs": 2851.500884000001
          },
          {
            "localMs": 2576,
            "frameMs": 30,
            "remoteObservedMs": 1855.6090550000008,
            "serverConfirmedMs": 4110.937215999998
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855798
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 25,
          "input": [],
          "moduleReadyMs": 74,
          "rowsReadyMs": 2250,
          "rowsFrameMs": 2292
        },
        "coldB": {
          "moduleStartMs": 24,
          "input": [],
          "moduleReadyMs": 48,
          "rowsReadyMs": 3778,
          "rowsFrameMs": 3820
        },
        "warmOffline": {
          "moduleStartMs": 16,
          "input": [],
          "moduleReadyMs": 42,
          "rowsReadyMs": 689,
          "rowsFrameMs": 718
        },
        "edits": [
          {
            "localMs": 1555,
            "frameMs": 60,
            "remoteObservedMs": 1825.2717469999916,
            "serverConfirmedMs": 2929.1247189999995
          },
          {
            "localMs": 1505,
            "frameMs": 34,
            "remoteObservedMs": 1314.2482690000033,
            "serverConfirmedMs": 2681.6106230000005
          },
          {
            "localMs": 2749,
            "frameMs": 24,
            "remoteObservedMs": 1342.5500370000082,
            "serverConfirmedMs": 3985.059558000008
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1855848
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 32,
          "input": [],
          "moduleReadyMs": 67,
          "rowsReadyMs": 2330,
          "rowsFrameMs": 2359
        },
        "coldB": {
          "moduleStartMs": 55,
          "input": [],
          "moduleReadyMs": 84,
          "rowsReadyMs": 3723,
          "rowsFrameMs": 3754
        },
        "warmOffline": {
          "moduleStartMs": 13,
          "input": [],
          "moduleReadyMs": 42,
          "rowsReadyMs": 711,
          "rowsFrameMs": 736
        },
        "edits": [
          {
            "localMs": 1564,
            "frameMs": 47,
            "remoteObservedMs": 1332.0369599999976,
            "serverConfirmedMs": 2564.375896999991
          },
          {
            "localMs": 1506,
            "frameMs": 25,
            "remoteObservedMs": 1314.8311119999998,
            "serverConfirmedMs": 3076.958037999997
          },
          {
            "localMs": 2571,
            "frameMs": 32,
            "remoteObservedMs": 1819.692041000002,
            "serverConfirmedMs": 3586.3725799999957
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
    "cpu": "AMD EPYC 9V45 96-Core Processor",
    "samples": [
      {
        "trial": 0,
        "coldA": {
          "moduleStartMs": 32,
          "input": [],
          "moduleReadyMs": 133,
          "rowsReadyMs": 789,
          "rowsFrameMs": 1133
        },
        "coldB": {
          "moduleStartMs": 23,
          "input": [],
          "moduleReadyMs": 97,
          "rowsReadyMs": 798,
          "rowsFrameMs": 1188
        },
        "warmOffline": {
          "moduleStartMs": 17,
          "input": [],
          "moduleReadyMs": 84,
          "rowsReadyMs": 334,
          "rowsFrameMs": 542
        },
        "edits": [
          {
            "localMs": 236,
            "frameMs": 237,
            "remoteObservedMs": 459.10737899999367,
            "serverConfirmedMs": 1511.8028760000016
          },
          {
            "localMs": 273,
            "frameMs": 274,
            "remoteObservedMs": 973.1584440000006,
            "serverConfirmedMs": 1454.5776939999778
          },
          {
            "localMs": 257,
            "frameMs": 257,
            "remoteObservedMs": 1836.5405319999845,
            "serverConfirmedMs": 2511.2941979999887
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018303
      },
      {
        "trial": 1,
        "coldA": {
          "moduleStartMs": 36,
          "input": [],
          "moduleReadyMs": 143,
          "rowsReadyMs": 773,
          "rowsFrameMs": 1158
        },
        "coldB": {
          "moduleStartMs": 19,
          "input": [],
          "moduleReadyMs": 105,
          "rowsReadyMs": 831,
          "rowsFrameMs": 1257
        },
        "warmOffline": {
          "moduleStartMs": 22,
          "input": [],
          "moduleReadyMs": 95,
          "rowsReadyMs": 355,
          "rowsFrameMs": 542
        },
        "edits": [
          {
            "localMs": 243,
            "frameMs": 243,
            "remoteObservedMs": 695.8918850000191,
            "serverConfirmedMs": 1434.035659999994
          },
          {
            "localMs": 324,
            "frameMs": 239,
            "remoteObservedMs": 1198.110554999992,
            "serverConfirmedMs": 1690.6425380000146
          },
          {
            "localMs": 272,
            "frameMs": 273,
            "remoteObservedMs": 977.9643679999863,
            "serverConfirmedMs": 1622.4664610000036
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018563
      },
      {
        "trial": 2,
        "coldA": {
          "moduleStartMs": 32,
          "input": [],
          "moduleReadyMs": 135,
          "rowsReadyMs": 734,
          "rowsFrameMs": 1089
        },
        "coldB": {
          "moduleStartMs": 24,
          "input": [],
          "moduleReadyMs": 109,
          "rowsReadyMs": 804,
          "rowsFrameMs": 1238
        },
        "warmOffline": {
          "moduleStartMs": 12,
          "input": [],
          "moduleReadyMs": 83,
          "rowsReadyMs": 306,
          "rowsFrameMs": 533
        },
        "edits": [
          {
            "localMs": 228,
            "frameMs": 228,
            "remoteObservedMs": 478.82510300001013,
            "serverConfirmedMs": 1612.579829000024
          },
          {
            "localMs": 237,
            "frameMs": 237,
            "remoteObservedMs": 963.6506749999826,
            "serverConfirmedMs": 1470.973463000002
          },
          {
            "localMs": 275,
            "frameMs": 276,
            "remoteObservedMs": 646.2603869999875,
            "serverConfirmedMs": 1484.682587999996
          }
        ],
        "rows": 10000,
        "storageRepresentationBytes": 1018773
      }
    ],
    "encodingImport": [
      {
        "mode": "snapshot",
        "repeat": 0,
        "bytes": 1018787,
        "importMs": 2,
        "projectionMs": 145,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 1,
        "bytes": 1018787,
        "importMs": 2,
        "projectionMs": 155,
        "allRowsMatch": true
      },
      {
        "mode": "snapshot",
        "repeat": 2,
        "bytes": 1018787,
        "importMs": 5,
        "projectionMs": 120,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 0,
        "bytes": 897531,
        "importMs": 157,
        "projectionMs": 79,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 1,
        "bytes": 897531,
        "importMs": 109,
        "projectionMs": 77,
        "allRowsMatch": true
      },
      {
        "mode": "update",
        "repeat": 2,
        "bytes": 897531,
        "importMs": 109,
        "projectionMs": 85,
        "allRowsMatch": true
      }
    ]
  }
]
```

