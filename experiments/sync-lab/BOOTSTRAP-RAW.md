# 0.10.1の初回配信と購読開始順の測定原票

実装 `8dc9b6ff1edb87bdf237d9236b02a8c308b5aecc`。
CI [40531131742](https://github.com/yohyng/taskapp/actions/runs/40531131742)、performanceジョブ `122283913928`。
CIの各`revision`はPRの合成mergeコミット `5bd7637dc25d637e68131e665fed748acd2bd338`。
各構成3反復。Loroの`warmUncompacted`は明示したまとめ直し前、`warmOffline`はその後の圏外起動。
`initialImportComparison`は同じsnapshotで各条件を一回ずつ分離し、全行一致も確認した結果。
保存・配信・DOMを含む起動時間とは区別する。説明・限界は [BOOTSTRAP.md](BOOTSTRAP.md)。

## 0.10.1 linux / yjs / chromium

```json
{
  "engine": "yjs",
  "browser": "chromium",
  "version": "153.0.8010.12",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V74 80-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "5bd7637dc25d637e68131e665fed748acd2bd338",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 37,
        "input": [],
        "moduleReadyMs": 71.90000000000873,
        "rowsReadyMs": 368.3000000000029,
        "rowsFrameMs": 390.8000000000029
      },
      "coldB": {
        "moduleStartMs": 24.5,
        "input": [],
        "moduleReadyMs": 51.5,
        "rowsReadyMs": 227.40000000000873,
        "rowsFrameMs": 246.1999999999971
      },
      "warmOffline": {
        "moduleStartMs": 15.5,
        "input": [],
        "moduleReadyMs": 22.19999999999709,
        "rowsReadyMs": 147.89999999999418,
        "rowsFrameMs": 153.1999999999971
      },
      "edits": [
        {
          "localMs": 18.5,
          "frameMs": 19.60000000000582,
          "remoteObservedMs": 28.517786000000342,
          "serverConfirmedMs": 1283.2615240000005
        },
        {
          "localMs": 19,
          "frameMs": 19.40000000000873,
          "remoteObservedMs": 28.66127200000028,
          "serverConfirmedMs": 1312.6387880000002
        },
        {
          "localMs": 16.39999999999418,
          "frameMs": 20.59999999999127,
          "remoteObservedMs": 30.23944599999959,
          "serverConfirmedMs": 1241.0787499999997
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683060
    },
    {
      "trial": 1,
      "coldA": {
        "moduleStartMs": 40.89999999999418,
        "input": [],
        "moduleReadyMs": 73.89999999999418,
        "rowsReadyMs": 347.3999999999942,
        "rowsFrameMs": 366.5
      },
      "coldB": {
        "moduleStartMs": 25.90000000000873,
        "input": [],
        "moduleReadyMs": 52.60000000000582,
        "rowsReadyMs": 225.60000000000582,
        "rowsFrameMs": 246
      },
      "warmOffline": {
        "moduleStartMs": 15.60000000000582,
        "input": [],
        "moduleReadyMs": 21.5,
        "rowsReadyMs": 144.8000000000029,
        "rowsFrameMs": 150
      },
      "edits": [
        {
          "localMs": 14.10000000000582,
          "frameMs": 24.5,
          "remoteObservedMs": 20.281402000000526,
          "serverConfirmedMs": 1307.7335359999997
        },
        {
          "localMs": 17.69999999999709,
          "frameMs": 32.60000000000582,
          "remoteObservedMs": 26.21413300000131,
          "serverConfirmedMs": 1208.7140529999997
        },
        {
          "localMs": 12.80000000000291,
          "frameMs": 20,
          "remoteObservedMs": 19.38331499999913,
          "serverConfirmedMs": 1290.3101810000007
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683169
    },
    {
      "trial": 2,
      "coldA": {
        "moduleStartMs": 30.39999999999418,
        "input": [],
        "moduleReadyMs": 64.19999999998254,
        "rowsReadyMs": 335.5,
        "rowsFrameMs": 355.29999999998836
      },
      "coldB": {
        "moduleStartMs": 26.199999999982538,
        "input": [],
        "moduleReadyMs": 58.39999999999418,
        "rowsReadyMs": 231.5,
        "rowsFrameMs": 252
      },
      "warmOffline": {
        "moduleStartMs": 79.39999999999418,
        "input": [],
        "moduleReadyMs": 89.89999999999418,
        "rowsReadyMs": 221.39999999999418,
        "rowsFrameMs": 237.19999999998254
      },
      "edits": [
        {
          "localMs": 13.300000000017462,
          "frameMs": 32.70000000001164,
          "remoteObservedMs": 22.948693999998795,
          "serverConfirmedMs": 1290.1409989999993
        },
        {
          "localMs": 21.89999999999418,
          "frameMs": 24.89999999999418,
          "remoteObservedMs": 26.10306700000001,
          "serverConfirmedMs": 1219.0212939999983
        },
        {
          "localMs": 13.300000000017462,
          "frameMs": 18.800000000017462,
          "remoteObservedMs": 21.565270999999484,
          "serverConfirmedMs": 1270.689918
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683278
    }
  ]
}
```

## 0.10.1 linux / powersync / chromium

```json
{
  "engine": "powersync",
  "browser": "chromium",
  "version": "153.0.8010.12",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V74 80-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "5bd7637dc25d637e68131e665fed748acd2bd338",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 32.30000000001746,
        "input": [],
        "moduleReadyMs": 57.20000000001164,
        "rowsReadyMs": 1395.5,
        "rowsFrameMs": 1414.4000000000233
      },
      "coldB": {
        "moduleStartMs": 24.199999999982538,
        "input": [],
        "moduleReadyMs": 42.19999999998254,
        "rowsReadyMs": 1410.7999999999884,
        "rowsFrameMs": 1437.5
      },
      "warmOffline": {
        "moduleStartMs": 22.5,
        "input": [],
        "moduleReadyMs": 30.29999999998836,
        "rowsReadyMs": 619,
        "rowsFrameMs": 640.5
      },
      "edits": [
        {
          "localMs": 1060.3999999999942,
          "frameMs": 21.29999999998836,
          "remoteObservedMs": 1307.4405729999999,
          "serverConfirmedMs": 2242.989880000001
        },
        {
          "localMs": 1041.3000000000175,
          "frameMs": 27.5,
          "remoteObservedMs": 790.202873000002,
          "serverConfirmedMs": 1759.6589690000037
        },
        {
          "localMs": 471.6000000000058,
          "frameMs": 31.39999999999418,
          "remoteObservedMs": 1288.5814069999979,
          "serverConfirmedMs": 2034.409811000005
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1855636
    },
    {
      "trial": 1,
      "coldA": {
        "moduleStartMs": 31.89999999999418,
        "input": [],
        "moduleReadyMs": 56.09999999997672,
        "rowsReadyMs": 1397.5999999999767,
        "rowsFrameMs": 1428
      },
      "coldB": {
        "moduleStartMs": 24.39999999999418,
        "input": [],
        "moduleReadyMs": 42.70000000001164,
        "rowsReadyMs": 1347.2000000000116,
        "rowsFrameMs": 1378.7999999999884
      },
      "warmOffline": {
        "moduleStartMs": 23.39999999999418,
        "input": [],
        "moduleReadyMs": 31.099999999976717,
        "rowsReadyMs": 622.3999999999942,
        "rowsFrameMs": 649.6999999999825
      },
      "edits": [
        {
          "localMs": 846.7000000000116,
          "frameMs": 24.900000000023283,
          "remoteObservedMs": 791.6851560000068,
          "serverConfirmedMs": 1637.2455429999973
        },
        {
          "localMs": 417.19999999998254,
          "frameMs": 28.199999999982538,
          "remoteObservedMs": 1299.054639000009,
          "serverConfirmedMs": 2045.4986590000044
        },
        {
          "localMs": 491.3999999999942,
          "frameMs": 23.39999999999418,
          "remoteObservedMs": 1293.6050259999902,
          "serverConfirmedMs": 1990.5748529999983
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1855692
    },
    {
      "trial": 2,
      "coldA": {
        "moduleStartMs": 35.10000000000582,
        "input": [],
        "moduleReadyMs": 59,
        "rowsReadyMs": 1466.8000000000175,
        "rowsFrameMs": 1486.3999999999942
      },
      "coldB": {
        "moduleStartMs": 23.300000000017462,
        "input": [],
        "moduleReadyMs": 41.10000000000582,
        "rowsReadyMs": 1421.7000000000116,
        "rowsFrameMs": 1451.1000000000058
      },
      "warmOffline": {
        "moduleStartMs": 21.60000000000582,
        "input": [],
        "moduleReadyMs": 53.30000000001746,
        "rowsReadyMs": 654.8000000000175,
        "rowsFrameMs": 680.3999999999942
      },
      "edits": [
        {
          "localMs": 859.5,
          "frameMs": 25.199999999982538,
          "remoteObservedMs": 792.4105770000024,
          "serverConfirmedMs": 1781.0509370000073
        },
        {
          "localMs": 831.8999999999942,
          "frameMs": 26.60000000000582,
          "remoteObservedMs": 789.2899420000031,
          "serverConfirmedMs": 1612.7575369999977
        },
        {
          "localMs": 395.79999999998836,
          "frameMs": 28.5,
          "remoteObservedMs": 1295.0995050000056,
          "serverConfirmedMs": 2186.6852849999996
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1855748
    }
  ]
}
```

## 0.10.1 linux / loro / chromium

```json
{
  "engine": "loro",
  "browser": "chromium",
  "version": "153.0.8010.12",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V74 80-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "5bd7637dc25d637e68131e665fed748acd2bd338",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 30.699999999982538,
        "input": [],
        "moduleReadyMs": 96.79999999998836,
        "rowsReadyMs": 568.3999999999942,
        "rowsFrameMs": 573.1999999999825
      },
      "coldB": {
        "moduleStartMs": 22.699999999982538,
        "input": [],
        "moduleReadyMs": 90.10000000000582,
        "rowsReadyMs": 566.8999999999942,
        "rowsFrameMs": 570.6999999999825
      },
      "transferA": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1017134
      },
      "transferB": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1017134
      },
      "warmUncompacted": {
        "moduleStartMs": 15.10000000000582,
        "input": [],
        "moduleReadyMs": 62.40000000002328,
        "rowsReadyMs": 310.4000000000233,
        "rowsFrameMs": 313.6000000000058
      },
      "warmOffline": {
        "moduleStartMs": 55.29999999998836,
        "input": [],
        "moduleReadyMs": 103.5,
        "rowsReadyMs": 373.69999999998254,
        "rowsFrameMs": 376.3999999999942
      },
      "edits": [
        {
          "localMs": 14,
          "frameMs": 26.89999999999418,
          "remoteObservedMs": 202.4462840000051,
          "serverConfirmedMs": 918.4640119999967
        },
        {
          "localMs": 3.3999999999941792,
          "frameMs": 22.79999999998836,
          "remoteObservedMs": 186.14850300000398,
          "serverConfirmedMs": 901.480555999995
        },
        {
          "localMs": 4.5,
          "frameMs": 18.60000000000582,
          "remoteObservedMs": 184.87080199999036,
          "serverConfirmedMs": 873.9528149999969
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1017554,
      "projectionBefore": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1017112,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1017112,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1017428,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1017428,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    },
    {
      "trial": 1,
      "coldA": {
        "moduleStartMs": 33.29999999998836,
        "input": [],
        "moduleReadyMs": 104.59999999997672,
        "rowsReadyMs": 563.1999999999825,
        "rowsFrameMs": 567.5999999999767
      },
      "coldB": {
        "moduleStartMs": 22.10000000000582,
        "input": [],
        "moduleReadyMs": 74,
        "rowsReadyMs": 580.8999999999942,
        "rowsFrameMs": 584.8999999999942
      },
      "transferA": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1017576
      },
      "transferB": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1017576
      },
      "warmUncompacted": {
        "moduleStartMs": 63.20000000001164,
        "input": [],
        "moduleReadyMs": 100.20000000001164,
        "rowsReadyMs": 356.4000000000233,
        "rowsFrameMs": 358.9000000000233
      },
      "warmOffline": {
        "moduleStartMs": 13.599999999976717,
        "input": [],
        "moduleReadyMs": 48.69999999998254,
        "rowsReadyMs": 294.29999999998836,
        "rowsFrameMs": 297.3999999999942
      },
      "edits": [
        {
          "localMs": 12.10000000000582,
          "frameMs": 31.29999999998836,
          "remoteObservedMs": 201.5529200000019,
          "serverConfirmedMs": 911.736493999997
        },
        {
          "localMs": 6.5,
          "frameMs": 19.39999999999418,
          "remoteObservedMs": 188.9177020000061,
          "serverConfirmedMs": 891.107136999999
        },
        {
          "localMs": 3.6999999999825377,
          "frameMs": 23.199999999982538,
          "remoteObservedMs": 185.78403199999593,
          "serverConfirmedMs": 880.1713469999959
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1017843,
      "projectionBefore": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1017554,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1017554,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1017888,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1017888,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    },
    {
      "trial": 2,
      "coldA": {
        "moduleStartMs": 31.79999999998836,
        "input": [],
        "moduleReadyMs": 99.29999999998836,
        "rowsReadyMs": 576.2000000000116,
        "rowsFrameMs": 580.2999999999884
      },
      "coldB": {
        "moduleStartMs": 22.800000000017462,
        "input": [],
        "moduleReadyMs": 79.20000000001164,
        "rowsReadyMs": 534.8999999999942,
        "rowsFrameMs": 539.1000000000058
      },
      "transferA": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1017865
      },
      "transferB": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1017865
      },
      "warmUncompacted": {
        "moduleStartMs": 43.39999999999418,
        "input": [],
        "moduleReadyMs": 80.60000000000582,
        "rowsReadyMs": 340,
        "rowsFrameMs": 343
      },
      "warmOffline": {
        "moduleStartMs": 14.5,
        "input": [],
        "moduleReadyMs": 50,
        "rowsReadyMs": 289.1000000000058,
        "rowsFrameMs": 291.6000000000058
      },
      "edits": [
        {
          "localMs": 14.200000000011642,
          "frameMs": 25.60000000000582,
          "remoteObservedMs": 199.095513999986,
          "serverConfirmedMs": 939.1787759999861
        },
        {
          "localMs": 5.399999999994179,
          "frameMs": 19,
          "remoteObservedMs": 188.08893399999943,
          "serverConfirmedMs": 897.1516589999956
        },
        {
          "localMs": 3.5,
          "frameMs": 32.10000000000582,
          "remoteObservedMs": 185.7082170000067,
          "serverConfirmedMs": 897.9057860000175
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1018079,
      "projectionBefore": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1017843,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1017843,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1018179,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1018179,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    }
  ],
  "encodingImport": [
    {
      "mode": "snapshot",
      "repeat": 0,
      "bytes": 1018095,
      "importMs": 0.7000000000116415,
      "projectionMs": 151.20000000001164,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 1,
      "bytes": 1018095,
      "importMs": 1.5,
      "projectionMs": 187.60000000000582,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 2,
      "bytes": 1018095,
      "importMs": 1.5,
      "projectionMs": 173,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 0,
      "bytes": 896622,
      "importMs": 196.80000000001746,
      "projectionMs": 88.19999999998254,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 1,
      "bytes": 896622,
      "importMs": 163.89999999999418,
      "projectionMs": 124,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 2,
      "bytes": 896622,
      "importMs": 160.5,
      "projectionMs": 108.79999999998836,
      "allRowsMatch": true
    }
  ],
  "initialImportComparison": [
    {
      "mode": "plain",
      "importMs": 0.8999999999941792,
      "allRowsMatch": true
    },
    {
      "mode": "handle",
      "importMs": 0.7999999999883585,
      "allRowsMatch": true
    },
    {
      "mode": "observe",
      "importMs": 364.70000000001164,
      "allRowsMatch": true
    },
    {
      "mode": "undo",
      "importMs": 188.29999999998836,
      "allRowsMatch": true
    },
    {
      "mode": "projection",
      "importMs": 536.6000000000058,
      "allRowsMatch": true
    }
  ],
  "projectionComparison": [
    {
      "mode": "full",
      "repeat": 0,
      "editAndProjectionMs": 163.60000000000582,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 1,
      "editAndProjectionMs": 191,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 2,
      "editAndProjectionMs": 209.60000000000582,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 3,
      "editAndProjectionMs": 211,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 4,
      "editAndProjectionMs": 216.69999999998254,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "incremental",
      "repeat": 0,
      "editAndProjectionMs": 0.5,
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
      "editAndProjectionMs": 1,
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
      "editAndProjectionMs": 0.6999999999825377,
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
      "editAndProjectionMs": 0.5,
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
}
```

## 0.10.1 linux / yjs / webkit

```json
{
  "engine": "yjs",
  "browser": "webkit",
  "version": "26.6",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V74 80-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "5bd7637dc25d637e68131e665fed748acd2bd338",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 34,
        "input": [],
        "moduleReadyMs": 76,
        "rowsReadyMs": 435,
        "rowsFrameMs": 467
      },
      "coldB": {
        "moduleStartMs": 26,
        "input": [],
        "moduleReadyMs": 57,
        "rowsReadyMs": 278,
        "rowsFrameMs": 310
      },
      "warmOffline": {
        "moduleStartMs": 11,
        "input": [],
        "moduleReadyMs": 30,
        "rowsReadyMs": 200,
        "rowsFrameMs": 221
      },
      "edits": [
        {
          "localMs": 35,
          "frameMs": 125,
          "remoteObservedMs": 38.706796999998915,
          "serverConfirmedMs": 631.1869379999989
        },
        {
          "localMs": 35,
          "frameMs": 47,
          "remoteObservedMs": 34.188756000001376,
          "serverConfirmedMs": 1139.196718000001
        },
        {
          "localMs": 25,
          "frameMs": 35,
          "remoteObservedMs": 24.715170000001308,
          "serverConfirmedMs": 1116.9822929999991
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683381
    },
    {
      "trial": 1,
      "coldA": {
        "moduleStartMs": 31,
        "input": [],
        "moduleReadyMs": 82,
        "rowsReadyMs": 439,
        "rowsFrameMs": 474
      },
      "coldB": {
        "moduleStartMs": 20,
        "input": [],
        "moduleReadyMs": 51,
        "rowsReadyMs": 262,
        "rowsFrameMs": 293
      },
      "warmOffline": {
        "moduleStartMs": 12,
        "input": [],
        "moduleReadyMs": 40,
        "rowsReadyMs": 221,
        "rowsFrameMs": 244
      },
      "edits": [
        {
          "localMs": 59,
          "frameMs": 92,
          "remoteObservedMs": 42.460189000001265,
          "serverConfirmedMs": 687.9251990000012
        },
        {
          "localMs": 34,
          "frameMs": 40,
          "remoteObservedMs": 31.87549399999989,
          "serverConfirmedMs": 1158.0336839999982
        },
        {
          "localMs": 25,
          "frameMs": 43,
          "remoteObservedMs": 23.90131399999882,
          "serverConfirmedMs": 1137.0631979999998
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683484
    },
    {
      "trial": 2,
      "coldA": {
        "moduleStartMs": 35,
        "input": [],
        "moduleReadyMs": 86,
        "rowsReadyMs": 446,
        "rowsFrameMs": 490
      },
      "coldB": {
        "moduleStartMs": 20,
        "input": [],
        "moduleReadyMs": 51,
        "rowsReadyMs": 275,
        "rowsFrameMs": 313
      },
      "warmOffline": {
        "moduleStartMs": 9,
        "input": [],
        "moduleReadyMs": 26,
        "rowsReadyMs": 198,
        "rowsFrameMs": 221
      },
      "edits": [
        {
          "localMs": 30,
          "frameMs": 44,
          "remoteObservedMs": 32.77462799999921,
          "serverConfirmedMs": 1156.346046999999
        },
        {
          "localMs": 38,
          "frameMs": 41,
          "remoteObservedMs": 32.43062900000223,
          "serverConfirmedMs": 1189.2397889999993
        },
        {
          "localMs": 27,
          "frameMs": 47,
          "remoteObservedMs": 24.864088000002084,
          "serverConfirmedMs": 1121.100618999997
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683587
    }
  ]
}
```

## 0.10.1 linux / powersync / webkit

```json
{
  "engine": "powersync",
  "browser": "webkit",
  "version": "26.6",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V74 80-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "5bd7637dc25d637e68131e665fed748acd2bd338",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 37,
        "input": [],
        "moduleReadyMs": 58,
        "rowsReadyMs": 3111,
        "rowsFrameMs": 3157
      },
      "coldB": {
        "moduleStartMs": 35,
        "input": [],
        "moduleReadyMs": 79,
        "rowsReadyMs": 5361,
        "rowsFrameMs": 5403
      },
      "warmOffline": {
        "moduleStartMs": 14,
        "input": [],
        "moduleReadyMs": 31,
        "rowsReadyMs": 772,
        "rowsFrameMs": 793
      },
      "edits": [
        {
          "localMs": 2055,
          "frameMs": 73,
          "remoteObservedMs": 2368.491525000005,
          "serverConfirmedMs": 4668.532993000008
        },
        {
          "localMs": 3950,
          "frameMs": 26,
          "remoteObservedMs": 2363.4538969999994,
          "serverConfirmedMs": 5740.811214999994
        },
        {
          "localMs": 2814,
          "frameMs": 23,
          "remoteObservedMs": 2309.431381000002,
          "serverConfirmedMs": 4103.397779999999
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
        "moduleReadyMs": 60,
        "rowsReadyMs": 3064,
        "rowsFrameMs": 3106
      },
      "coldB": {
        "moduleStartMs": 36,
        "input": [],
        "moduleReadyMs": 74,
        "rowsReadyMs": 6425,
        "rowsFrameMs": 6461
      },
      "warmOffline": {
        "moduleStartMs": 12,
        "input": [],
        "moduleReadyMs": 22,
        "rowsReadyMs": 782,
        "rowsFrameMs": 804
      },
      "edits": [
        {
          "localMs": 2581,
          "frameMs": 66,
          "remoteObservedMs": 2359.2734809999965,
          "serverConfirmedMs": 4908.518452000004
        },
        {
          "localMs": 3629,
          "frameMs": 31,
          "remoteObservedMs": 2327.0841870000004,
          "serverConfirmedMs": 4909.197364000007
        },
        {
          "localMs": 2430,
          "frameMs": 31,
          "remoteObservedMs": 1804.0178799999994,
          "serverConfirmedMs": 3446.3761470000027
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
        "moduleReadyMs": 69,
        "rowsReadyMs": 2993,
        "rowsFrameMs": 3046
      },
      "coldB": {
        "moduleStartMs": 38,
        "input": [],
        "moduleReadyMs": 69,
        "rowsReadyMs": 5859,
        "rowsFrameMs": 5901
      },
      "warmOffline": {
        "moduleStartMs": 12,
        "input": [],
        "moduleReadyMs": 37,
        "rowsReadyMs": 745,
        "rowsFrameMs": 778
      },
      "edits": [
        {
          "localMs": 2161,
          "frameMs": 67,
          "remoteObservedMs": 2343.4170169999998,
          "serverConfirmedMs": 3960.506395000004
        },
        {
          "localMs": 4036,
          "frameMs": 22,
          "remoteObservedMs": 2326.697302000015,
          "serverConfirmedMs": 5724.0321889999905
        },
        {
          "localMs": 3007,
          "frameMs": 27,
          "remoteObservedMs": 2308.3553510000056,
          "serverConfirmedMs": 4250.49568599998
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1855898
    }
  ]
}
```

## 0.10.1 linux / loro / webkit

```json
{
  "engine": "loro",
  "browser": "webkit",
  "version": "26.6",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V74 80-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "5bd7637dc25d637e68131e665fed748acd2bd338",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 39,
        "input": [],
        "moduleReadyMs": 186,
        "rowsReadyMs": 650,
        "rowsFrameMs": 679
      },
      "coldB": {
        "moduleStartMs": 32,
        "input": [],
        "moduleReadyMs": 128,
        "rowsReadyMs": 612,
        "rowsFrameMs": 634
      },
      "transferA": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1018101
      },
      "transferB": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1018101
      },
      "warmUncompacted": {
        "moduleStartMs": 18,
        "input": [],
        "moduleReadyMs": 135,
        "rowsReadyMs": 484,
        "rowsFrameMs": 500
      },
      "warmOffline": {
        "moduleStartMs": 10,
        "input": [],
        "moduleReadyMs": 100,
        "rowsReadyMs": 436,
        "rowsFrameMs": 449
      },
      "edits": [
        {
          "localMs": 17,
          "frameMs": 38,
          "remoteObservedMs": 208.12747999999556,
          "serverConfirmedMs": 833.4503440000117
        },
        {
          "localMs": 11,
          "frameMs": 29,
          "remoteObservedMs": 198.79774400001043,
          "serverConfirmedMs": 807.0068370000226
        },
        {
          "localMs": 13,
          "frameMs": 30,
          "remoteObservedMs": 195.76224000001093,
          "serverConfirmedMs": 844.5997920000227
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1018295,
      "projectionBefore": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1018079,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1018079,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1018409,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1018409,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    },
    {
      "trial": 1,
      "coldA": {
        "moduleStartMs": 31,
        "input": [],
        "moduleReadyMs": 180,
        "rowsReadyMs": 655,
        "rowsFrameMs": 677
      },
      "coldB": {
        "moduleStartMs": 22,
        "input": [],
        "moduleReadyMs": 151,
        "rowsReadyMs": 646,
        "rowsFrameMs": 666
      },
      "transferA": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1018317
      },
      "transferB": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1018317
      },
      "warmUncompacted": {
        "moduleStartMs": 9,
        "input": [],
        "moduleReadyMs": 90,
        "rowsReadyMs": 435,
        "rowsFrameMs": 448
      },
      "warmOffline": {
        "moduleStartMs": 13,
        "input": [],
        "moduleReadyMs": 90,
        "rowsReadyMs": 451,
        "rowsFrameMs": 468
      },
      "edits": [
        {
          "localMs": 22,
          "frameMs": 44,
          "remoteObservedMs": 312.28845699998783,
          "serverConfirmedMs": 919.9798390000069
        },
        {
          "localMs": 10,
          "frameMs": 30,
          "remoteObservedMs": 195.74126999999862,
          "serverConfirmedMs": 813.6988419999834
        },
        {
          "localMs": 13,
          "frameMs": 31,
          "remoteObservedMs": 201.54999999998836,
          "serverConfirmedMs": 821.5353780000005
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1018526,
      "projectionBefore": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1018295,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1018295,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1018625,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1018625,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    },
    {
      "trial": 2,
      "coldA": {
        "moduleStartMs": 37,
        "input": [],
        "moduleReadyMs": 179,
        "rowsReadyMs": 676,
        "rowsFrameMs": 699
      },
      "coldB": {
        "moduleStartMs": 20,
        "input": [],
        "moduleReadyMs": 134,
        "rowsReadyMs": 609,
        "rowsFrameMs": 630
      },
      "transferA": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1018548
      },
      "transferB": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1018548
      },
      "warmUncompacted": {
        "moduleStartMs": 13,
        "input": [],
        "moduleReadyMs": 89,
        "rowsReadyMs": 436,
        "rowsFrameMs": 451
      },
      "warmOffline": {
        "moduleStartMs": 10,
        "input": [],
        "moduleReadyMs": 102,
        "rowsReadyMs": 465,
        "rowsFrameMs": 479
      },
      "edits": [
        {
          "localMs": 22,
          "frameMs": 38,
          "remoteObservedMs": 313.56592699998873,
          "serverConfirmedMs": 971.0600519999862
        },
        {
          "localMs": 11,
          "frameMs": 32,
          "remoteObservedMs": 196.43504400001257,
          "serverConfirmedMs": 839.5563390000025
        },
        {
          "localMs": 15,
          "frameMs": 25,
          "remoteObservedMs": 818.8681550000038,
          "serverConfirmedMs": 1509.055680999998
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1018771,
      "projectionBefore": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1018526,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1018526,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1018856,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1018856,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    }
  ],
  "encodingImport": [
    {
      "mode": "snapshot",
      "repeat": 0,
      "bytes": 1018786,
      "importMs": 1,
      "projectionMs": 184,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 1,
      "bytes": 1018786,
      "importMs": 2,
      "projectionMs": 201,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 2,
      "bytes": 1018786,
      "importMs": 2,
      "projectionMs": 179,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 0,
      "bytes": 897531,
      "importMs": 210,
      "projectionMs": 102,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 1,
      "bytes": 897531,
      "importMs": 147,
      "projectionMs": 113,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 2,
      "bytes": 897531,
      "importMs": 148,
      "projectionMs": 105,
      "allRowsMatch": true
    }
  ],
  "initialImportComparison": [
    {
      "mode": "plain",
      "importMs": 1,
      "allRowsMatch": true
    },
    {
      "mode": "handle",
      "importMs": 1,
      "allRowsMatch": true
    },
    {
      "mode": "observe",
      "importMs": 374,
      "allRowsMatch": true
    },
    {
      "mode": "undo",
      "importMs": 227,
      "allRowsMatch": true
    },
    {
      "mode": "projection",
      "importMs": 542,
      "allRowsMatch": true
    }
  ],
  "projectionComparison": [
    {
      "mode": "full",
      "repeat": 0,
      "editAndProjectionMs": 199,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 1,
      "editAndProjectionMs": 237,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 2,
      "editAndProjectionMs": 238,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 3,
      "editAndProjectionMs": 204,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 4,
      "editAndProjectionMs": 189,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "incremental",
      "repeat": 0,
      "editAndProjectionMs": 4,
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
      "editAndProjectionMs": 4,
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

## 0.10.1 win32 / loro / webkit

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
        "moduleStartMs": 55,
        "input": [],
        "moduleReadyMs": 175,
        "rowsReadyMs": 853,
        "rowsFrameMs": 879
      },
      "coldB": {
        "moduleStartMs": 57,
        "input": [],
        "moduleReadyMs": 191,
        "rowsReadyMs": 897,
        "rowsFrameMs": 925
      },
      "transferA": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1021380
      },
      "transferB": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1021380
      },
      "warmUncompacted": {
        "moduleStartMs": 58,
        "input": [],
        "moduleReadyMs": 179,
        "rowsReadyMs": 796,
        "rowsFrameMs": 818
      },
      "warmOffline": {
        "moduleStartMs": 52,
        "input": [],
        "moduleReadyMs": 182,
        "rowsReadyMs": 735,
        "rowsFrameMs": 765
      },
      "edits": [
        {
          "localMs": 49,
          "frameMs": 31,
          "remoteObservedMs": 385.84799999999996,
          "serverConfirmedMs": 847.7295000000004
        },
        {
          "localMs": 55,
          "frameMs": 36,
          "remoteObservedMs": 233.47400000000016,
          "serverConfirmedMs": 676.6691000000001
        },
        {
          "localMs": 45,
          "frameMs": 29,
          "remoteObservedMs": 232.86749999999938,
          "serverConfirmedMs": 686.4942000000001
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1021552,
      "projectionBefore": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1021358,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1021358,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1021688,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1021688,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    },
    {
      "trial": 1,
      "coldA": {
        "moduleStartMs": 61,
        "input": [],
        "moduleReadyMs": 180,
        "rowsReadyMs": 874,
        "rowsFrameMs": 898
      },
      "coldB": {
        "moduleStartMs": 74,
        "input": [],
        "moduleReadyMs": 195,
        "rowsReadyMs": 852,
        "rowsFrameMs": 883
      },
      "transferA": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1021574
      },
      "transferB": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1021574
      },
      "warmUncompacted": {
        "moduleStartMs": 50,
        "input": [],
        "moduleReadyMs": 221,
        "rowsReadyMs": 767,
        "rowsFrameMs": 794
      },
      "warmOffline": {
        "moduleStartMs": 44,
        "input": [],
        "moduleReadyMs": 151,
        "rowsReadyMs": 691,
        "rowsFrameMs": 709
      },
      "edits": [
        {
          "localMs": 52,
          "frameMs": 35,
          "remoteObservedMs": 359.40279999999984,
          "serverConfirmedMs": 789.7672999999995
        },
        {
          "localMs": 48,
          "frameMs": 33,
          "remoteObservedMs": 229.96919999999955,
          "serverConfirmedMs": 660.5473999999995
        },
        {
          "localMs": 48,
          "frameMs": 29,
          "remoteObservedMs": 228.25239999999758,
          "serverConfirmedMs": 655.1326000000008
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1021792,
      "projectionBefore": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1021552,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1021552,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1021882,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1021882,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    },
    {
      "trial": 2,
      "coldA": {
        "moduleStartMs": 67,
        "input": [],
        "moduleReadyMs": 187,
        "rowsReadyMs": 867,
        "rowsFrameMs": 910
      },
      "coldB": {
        "moduleStartMs": 58,
        "input": [],
        "moduleReadyMs": 166,
        "rowsReadyMs": 802,
        "rowsFrameMs": 835
      },
      "transferA": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1021814
      },
      "transferB": {
        "snapshots": 1,
        "updates": 1,
        "receivedBytes": 1021814
      },
      "warmUncompacted": {
        "moduleStartMs": 56,
        "input": [],
        "moduleReadyMs": 163,
        "rowsReadyMs": 709,
        "rowsFrameMs": 735
      },
      "warmOffline": {
        "moduleStartMs": 57,
        "input": [],
        "moduleReadyMs": 164,
        "rowsReadyMs": 679,
        "rowsFrameMs": 706
      },
      "edits": [
        {
          "localMs": 57,
          "frameMs": 38,
          "remoteObservedMs": 345.9354000000021,
          "serverConfirmedMs": 803.4852000000028
        },
        {
          "localMs": 43,
          "frameMs": 27,
          "remoteObservedMs": 345.6231999999982,
          "serverConfirmedMs": 773.3244999999988
        },
        {
          "localMs": 48,
          "frameMs": 30,
          "remoteObservedMs": 335.9357999999993,
          "serverConfirmedMs": 758.2275000000009
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1022171,
      "projectionBefore": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 1,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1021792,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1021792,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1022122,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1022122,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    }
  ],
  "encodingImport": [
    {
      "mode": "snapshot",
      "repeat": 0,
      "bytes": 1022193,
      "importMs": 1,
      "projectionMs": 513,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 1,
      "bytes": 1022193,
      "importMs": 16,
      "projectionMs": 874,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 2,
      "bytes": 1022193,
      "importMs": 32,
      "projectionMs": 1196,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 0,
      "bytes": 901890,
      "importMs": 19380,
      "projectionMs": 80,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 1,
      "bytes": 901890,
      "importMs": 8773,
      "projectionMs": 83,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 2,
      "bytes": 901890,
      "importMs": 10446,
      "projectionMs": 83,
      "allRowsMatch": true
    }
  ],
  "initialImportComparison": [
    {
      "mode": "plain",
      "importMs": 1,
      "allRowsMatch": true
    },
    {
      "mode": "handle",
      "importMs": 1,
      "allRowsMatch": true
    },
    {
      "mode": "observe",
      "importMs": 9580,
      "allRowsMatch": true
    },
    {
      "mode": "undo",
      "importMs": 29928,
      "allRowsMatch": true
    },
    {
      "mode": "projection",
      "importMs": 36397,
      "allRowsMatch": true
    }
  ],
  "projectionComparison": [
    {
      "mode": "full",
      "repeat": 0,
      "editAndProjectionMs": 179,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 1,
      "editAndProjectionMs": 155,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 2,
      "editAndProjectionMs": 159,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 3,
      "editAndProjectionMs": 162,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 4,
      "editAndProjectionMs": 159,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "incremental",
      "repeat": 0,
      "editAndProjectionMs": 4,
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
      "editAndProjectionMs": 4,
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
      "editAndProjectionMs": 4,
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
      "editAndProjectionMs": 4,
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

## 参考：0.10.0 Windows、配信形式だけをsnapshotへ変えた時点

コード `f211c72f8ce21f6c2e401da362ca130825553005`。ローカル一万行1件が3反復と形式別比較まで約3.5分で成功。
購読とUndoを初回取り込み前に付けたままで、初回10秒台の待ちが残った。
この値と0.10.1は同じPC・ブラウザーの別実行であり、厳密な速度倍率とはしない。

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
        "moduleStartMs": 77,
        "input": [],
        "moduleReadyMs": 201,
        "rowsReadyMs": 11678,
        "rowsFrameMs": 11727
      },
      "coldB": {
        "moduleStartMs": 74,
        "input": [],
        "moduleReadyMs": 228,
        "rowsReadyMs": 14710,
        "rowsFrameMs": 14753
      },
      "transferA": {
        "snapshots": 1,
        "updates": 0,
        "receivedBytes": 1020735
      },
      "transferB": {
        "snapshots": 1,
        "updates": 0,
        "receivedBytes": 1020735
      },
      "warmUncompacted": {
        "moduleStartMs": 70,
        "input": [],
        "moduleReadyMs": 211,
        "rowsReadyMs": 1069,
        "rowsFrameMs": 1095
      },
      "warmOffline": {
        "moduleStartMs": 58,
        "input": [],
        "moduleReadyMs": 188,
        "rowsReadyMs": 996,
        "rowsFrameMs": 1020
      },
      "edits": [
        {
          "localMs": 70,
          "frameMs": 51,
          "remoteObservedMs": 368.4660999999978,
          "serverConfirmedMs": 1120.8752999999997
        },
        {
          "localMs": 51,
          "frameMs": 48,
          "remoteObservedMs": 348.344600000004,
          "serverConfirmedMs": 1033.1525000000038
        },
        {
          "localMs": 51,
          "frameMs": 31,
          "remoteObservedMs": 344.8980999999985,
          "serverConfirmedMs": 1049.7957999999999
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1020963,
      "projectionBefore": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1020735,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1020735,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1021065,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1021065,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    },
    {
      "trial": 1,
      "coldA": {
        "moduleStartMs": 71,
        "input": [],
        "moduleReadyMs": 191,
        "rowsReadyMs": 10595,
        "rowsFrameMs": 10633
      },
      "coldB": {
        "moduleStartMs": 110,
        "input": [],
        "moduleReadyMs": 274,
        "rowsReadyMs": 10875,
        "rowsFrameMs": 10914
      },
      "transferA": {
        "snapshots": 1,
        "updates": 0,
        "receivedBytes": 1020963
      },
      "transferB": {
        "snapshots": 1,
        "updates": 0,
        "receivedBytes": 1020963
      },
      "warmUncompacted": {
        "moduleStartMs": 57,
        "input": [],
        "moduleReadyMs": 182,
        "rowsReadyMs": 1012,
        "rowsFrameMs": 1045
      },
      "warmOffline": {
        "moduleStartMs": 63,
        "input": [],
        "moduleReadyMs": 222,
        "rowsReadyMs": 933,
        "rowsFrameMs": 963
      },
      "edits": [
        {
          "localMs": 67,
          "frameMs": 44,
          "remoteObservedMs": 366.7250000000058,
          "serverConfirmedMs": 1045.1714000000065
        },
        {
          "localMs": 48,
          "frameMs": 45,
          "remoteObservedMs": 247.03459999999905,
          "serverConfirmedMs": 882.3055000000022
        },
        {
          "localMs": 70,
          "frameMs": 46,
          "remoteObservedMs": 369.84279999999853,
          "serverConfirmedMs": 1049.9421000000002
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1021160,
      "projectionBefore": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1020963,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1020963,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1021293,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1021293,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    },
    {
      "trial": 2,
      "coldA": {
        "moduleStartMs": 63,
        "input": [],
        "moduleReadyMs": 180,
        "rowsReadyMs": 10491,
        "rowsFrameMs": 10539
      },
      "coldB": {
        "moduleStartMs": 71,
        "input": [],
        "moduleReadyMs": 209,
        "rowsReadyMs": 10430,
        "rowsFrameMs": 10467
      },
      "transferA": {
        "snapshots": 1,
        "updates": 0,
        "receivedBytes": 1021160
      },
      "transferB": {
        "snapshots": 1,
        "updates": 0,
        "receivedBytes": 1021160
      },
      "warmUncompacted": {
        "moduleStartMs": 71,
        "input": [],
        "moduleReadyMs": 202,
        "rowsReadyMs": 1002,
        "rowsFrameMs": 1037
      },
      "warmOffline": {
        "moduleStartMs": 48,
        "input": [],
        "moduleReadyMs": 204,
        "rowsReadyMs": 923,
        "rowsFrameMs": 948
      },
      "edits": [
        {
          "localMs": 60,
          "frameMs": 43,
          "remoteObservedMs": 246.4609999999957,
          "serverConfirmedMs": 887.0184000000008
        },
        {
          "localMs": 61,
          "frameMs": 31,
          "remoteObservedMs": 248.38420000000042,
          "serverConfirmedMs": 959.8141000000032
        },
        {
          "localMs": 56,
          "frameMs": 39,
          "remoteObservedMs": 240.81080000000657,
          "serverConfirmedMs": 927.0810000000056
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1021358,
      "projectionBefore": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 0
      },
      "projectionAfter": {
        "fullRebuilds": 2,
        "fullRowReads": 10000,
        "incrementalRowReads": 3
      },
      "persistenceBefore": {
        "appendTransactions": 1,
        "appendedUpdates": 1,
        "appendedBytes": 1021160,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 1021160,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 1021490,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 1021490,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 0,
        "appendedUpdates": 0,
        "appendedBytes": 0,
        "compactions": 1,
        "checkpointExports": 1,
        "journalCount": 0,
        "journalBytes": 0,
        "compactionFailures": 0
      }
    }
  ],
  "encodingImport": [
    {
      "mode": "snapshot",
      "repeat": 0,
      "bytes": 1021374,
      "importMs": 1,
      "projectionMs": 826,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 1,
      "bytes": 1021374,
      "importMs": 31,
      "projectionMs": 1303,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 2,
      "bytes": 1021374,
      "importMs": 37,
      "projectionMs": 1735,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 0,
      "bytes": 900981,
      "importMs": 27429,
      "projectionMs": 134,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 1,
      "bytes": 900981,
      "importMs": 12154,
      "projectionMs": 107,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 2,
      "bytes": 900981,
      "importMs": 14472,
      "projectionMs": 104,
      "allRowsMatch": true
    }
  ],
  "projectionComparison": [
    {
      "mode": "full",
      "repeat": 0,
      "editAndProjectionMs": 216,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 1,
      "editAndProjectionMs": 232,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 2,
      "editAndProjectionMs": 307,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 3,
      "editAndProjectionMs": 217,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 4,
      "editAndProjectionMs": 197,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "incremental",
      "repeat": 0,
      "editAndProjectionMs": 5,
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
      "editAndProjectionMs": 80,
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
