# 0.9.0の差分保存の測定原票

実装 `cf5ce2b903d03a3c5fdc30dcc62b1642b21e12e3`。
CI [40516598089](https://github.com/yohyng/taskapp/actions/runs/40516598089)、performanceジョブ `122231956276`。
CIの測定対象checkoutは各原票の`revision`にあるPRの合成mergeコミット。
各構成は三回反復。圏外起動は明示したまとめ直しの後で、未集約ログの起動時間ではない。
`appendedBytes`は更新ログへ加える差分本体の合計で、outboxや索引等を含む物理I/O量ではない。
説明・限界は [PERSISTENCE.md](PERSISTENCE.md)。

## linux / yjs / chromium

```json
{
  "engine": "yjs",
  "browser": "chromium",
  "version": "153.0.8010.12",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V45 96-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "f2d42594fa3ea82e73d61e5143b44655ac262ec0",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 36.39999999999418,
        "input": [],
        "moduleReadyMs": 74.29999999998836,
        "rowsReadyMs": 315.0999999999767,
        "rowsFrameMs": 332.5
      },
      "coldB": {
        "moduleStartMs": 22.5,
        "input": [],
        "moduleReadyMs": 44.90000000002328,
        "rowsReadyMs": 201.20000000001164,
        "rowsFrameMs": 219.40000000002328
      },
      "warmOffline": {
        "moduleStartMs": 14.099999999976717,
        "input": [],
        "moduleReadyMs": 21.199999999982538,
        "rowsReadyMs": 146.69999999998254,
        "rowsFrameMs": 154.39999999999418
      },
      "edits": [
        {
          "localMs": 18.60000000000582,
          "frameMs": 26.60000000000582,
          "remoteObservedMs": 27.87570000000005,
          "serverConfirmedMs": 1142.4811480000003
        },
        {
          "localMs": 19.699999999982538,
          "frameMs": 16,
          "remoteObservedMs": 28.3112459999993,
          "serverConfirmedMs": 1101.4698179999996
        },
        {
          "localMs": 18.29999999998836,
          "frameMs": 17.5,
          "remoteObservedMs": 33.058968999999706,
          "serverConfirmedMs": 1062.3270499999999
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683060
    },
    {
      "trial": 1,
      "coldA": {
        "moduleStartMs": 47.20000000001164,
        "input": [],
        "moduleReadyMs": 91.39999999999418,
        "rowsReadyMs": 350.8999999999942,
        "rowsFrameMs": 369.3999999999942
      },
      "coldB": {
        "moduleStartMs": 30.39999999999418,
        "input": [],
        "moduleReadyMs": 56.89999999999418,
        "rowsReadyMs": 224.19999999998254,
        "rowsFrameMs": 244.79999999998836
      },
      "warmOffline": {
        "moduleStartMs": 14.799999999988358,
        "input": [],
        "moduleReadyMs": 21.29999999998836,
        "rowsReadyMs": 136.10000000000582,
        "rowsFrameMs": 141.60000000000582
      },
      "edits": [
        {
          "localMs": 13.199999999982538,
          "frameMs": 25,
          "remoteObservedMs": 25.47913399999925,
          "serverConfirmedMs": 1092.1376339999988
        },
        {
          "localMs": 21.099999999976717,
          "frameMs": 19,
          "remoteObservedMs": 24.808078000000023,
          "serverConfirmedMs": 1054.5619420000003
        },
        {
          "localMs": 14.900000000023283,
          "frameMs": 13.700000000011642,
          "remoteObservedMs": 18.45867299999918,
          "serverConfirmedMs": 1087.2559929999989
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683169
    },
    {
      "trial": 2,
      "coldA": {
        "moduleStartMs": 35.20000000001164,
        "input": [],
        "moduleReadyMs": 66.5,
        "rowsReadyMs": 306.80000000001746,
        "rowsFrameMs": 327.4000000000233
      },
      "coldB": {
        "moduleStartMs": 22.5,
        "input": [],
        "moduleReadyMs": 58.29999999998836,
        "rowsReadyMs": 236.19999999998254,
        "rowsFrameMs": 257.29999999998836
      },
      "warmOffline": {
        "moduleStartMs": 13.89999999999418,
        "input": [],
        "moduleReadyMs": 20.10000000000582,
        "rowsReadyMs": 129.79999999998836,
        "rowsFrameMs": 135.29999999998836
      },
      "edits": [
        {
          "localMs": 14.300000000017462,
          "frameMs": 23.20000000001164,
          "remoteObservedMs": 22.284002000000328,
          "serverConfirmedMs": 1073.9113460000008
        },
        {
          "localMs": 20.79999999998836,
          "frameMs": 29.5,
          "remoteObservedMs": 38.85741399999824,
          "serverConfirmedMs": 1084.289205000001
        },
        {
          "localMs": 15.89999999999418,
          "frameMs": 22.89999999999418,
          "remoteObservedMs": 21.261458000000857,
          "serverConfirmedMs": 1095.5746900000013
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683278
    }
  ]
}
```

## linux / powersync / chromium

```json
{
  "engine": "powersync",
  "browser": "chromium",
  "version": "153.0.8010.12",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V45 96-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "f2d42594fa3ea82e73d61e5143b44655ac262ec0",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 34.60000000000582,
        "input": [],
        "moduleReadyMs": 57.5,
        "rowsReadyMs": 1426.6000000000058,
        "rowsFrameMs": 1458.7000000000116
      },
      "coldB": {
        "moduleStartMs": 29.10000000000582,
        "input": [],
        "moduleReadyMs": 48.30000000001746,
        "rowsReadyMs": 1402.9000000000233,
        "rowsFrameMs": 1424.6000000000058
      },
      "warmOffline": {
        "moduleStartMs": 19.79999999998836,
        "input": [],
        "moduleReadyMs": 27.699999999982538,
        "rowsReadyMs": 510.79999999998836,
        "rowsFrameMs": 539.8999999999942
      },
      "edits": [
        {
          "localMs": 707.6000000000058,
          "frameMs": 28.79999999998836,
          "remoteObservedMs": 795.9440950000062,
          "serverConfirmedMs": 1414.3819270000022
        },
        {
          "localMs": 312.6000000000058,
          "frameMs": 28,
          "remoteObservedMs": 1291.172102000004,
          "serverConfirmedMs": 1894.6321430000025
        },
        {
          "localMs": 304.4000000000233,
          "frameMs": 29.60000000000582,
          "remoteObservedMs": 1293.8269549999968,
          "serverConfirmedMs": 1846.4416560000027
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1855636
    },
    {
      "trial": 1,
      "coldA": {
        "moduleStartMs": 29,
        "input": [],
        "moduleReadyMs": 51.30000000001746,
        "rowsReadyMs": 1120.7000000000116,
        "rowsFrameMs": 1137.3999999999942
      },
      "coldB": {
        "moduleStartMs": 23.800000000017462,
        "input": [],
        "moduleReadyMs": 43.30000000001746,
        "rowsReadyMs": 1111.6000000000058,
        "rowsFrameMs": 1144.3000000000175
      },
      "warmOffline": {
        "moduleStartMs": 18.89999999999418,
        "input": [],
        "moduleReadyMs": 35.19999999998254,
        "rowsReadyMs": 528,
        "rowsFrameMs": 554.1999999999825
      },
      "edits": [
        {
          "localMs": 707.1000000000058,
          "frameMs": 26.89999999999418,
          "remoteObservedMs": 794.5146109999987,
          "serverConfirmedMs": 1471.4472040000037
        },
        {
          "localMs": 313.5,
          "frameMs": 2.099999999976717,
          "remoteObservedMs": 1286.4373829999968,
          "serverConfirmedMs": 1803.516079000001
        },
        {
          "localMs": 325.79999999998836,
          "frameMs": 10.89999999999418,
          "remoteObservedMs": 1289.7864899999986,
          "serverConfirmedMs": 1818.9486079999988
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1855692
    },
    {
      "trial": 2,
      "coldA": {
        "moduleStartMs": 31,
        "input": [],
        "moduleReadyMs": 53.89999999999418,
        "rowsReadyMs": 1140.6000000000058,
        "rowsFrameMs": 1173.5
      },
      "coldB": {
        "moduleStartMs": 22.10000000000582,
        "input": [],
        "moduleReadyMs": 37.10000000000582,
        "rowsReadyMs": 1155.2999999999884,
        "rowsFrameMs": 1174.2999999999884
      },
      "warmOffline": {
        "moduleStartMs": 19.79999999998836,
        "input": [],
        "moduleReadyMs": 27.10000000000582,
        "rowsReadyMs": 513.6999999999825,
        "rowsFrameMs": 534.2999999999884
      },
      "edits": [
        {
          "localMs": 704.6000000000058,
          "frameMs": 26.300000000017462,
          "remoteObservedMs": 790.956216000006,
          "serverConfirmedMs": 1439.8358799999987
        },
        {
          "localMs": 312.30000000001746,
          "frameMs": 13.700000000011642,
          "remoteObservedMs": 1287.7137020000082,
          "serverConfirmedMs": 1795.9919769999979
        },
        {
          "localMs": 311.69999999998254,
          "frameMs": 14.299999999988358,
          "remoteObservedMs": 1295.8414140000095,
          "serverConfirmedMs": 1938.8887410000025
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1855748
    }
  ]
}
```

## linux / loro / chromium

```json
{
  "engine": "loro",
  "browser": "chromium",
  "version": "153.0.8010.12",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V45 96-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "f2d42594fa3ea82e73d61e5143b44655ac262ec0",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 30.20000000001164,
        "input": [],
        "moduleReadyMs": 88.10000000000582,
        "rowsReadyMs": 813.6000000000058,
        "rowsFrameMs": 820
      },
      "coldB": {
        "moduleStartMs": 32.89999999999418,
        "input": [],
        "moduleReadyMs": 77.19999999998254,
        "rowsReadyMs": 838.5,
        "rowsFrameMs": 844.3999999999942
      },
      "warmOffline": {
        "moduleStartMs": 15.60000000000582,
        "input": [],
        "moduleReadyMs": 51.20000000001164,
        "rowsReadyMs": 284.3999999999942,
        "rowsFrameMs": 286.6000000000058
      },
      "edits": [
        {
          "localMs": 8.60000000000582,
          "frameMs": 29.70000000001164,
          "remoteObservedMs": 298.6790270000056,
          "serverConfirmedMs": 934.609884999998
        },
        {
          "localMs": 5.7999999999883585,
          "frameMs": 8.599999999976717,
          "remoteObservedMs": 185.83368199999677,
          "serverConfirmedMs": 737.9575590000022
        },
        {
          "localMs": 4.399999999994179,
          "frameMs": 4,
          "remoteObservedMs": 295.37699799999245,
          "serverConfirmedMs": 854.3644369999965
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1017591,
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
        "appendedBytes": 895713,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 895713,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 896029,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 896029,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 896029,
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
        "moduleStartMs": 56.89999999999418,
        "input": [],
        "moduleReadyMs": 116.39999999999418,
        "rowsReadyMs": 877.3999999999942,
        "rowsFrameMs": 883.3999999999942
      },
      "coldB": {
        "moduleStartMs": 32.19999999998254,
        "input": [],
        "moduleReadyMs": 76.39999999999418,
        "rowsReadyMs": 842.6999999999825,
        "rowsFrameMs": 849.2999999999884
      },
      "warmOffline": {
        "moduleStartMs": 16,
        "input": [],
        "moduleReadyMs": 48.69999999998254,
        "rowsReadyMs": 289.1000000000058,
        "rowsFrameMs": 291.19999999998254
      },
      "edits": [
        {
          "localMs": 7.300000000017462,
          "frameMs": 26,
          "remoteObservedMs": 196.6936340000102,
          "serverConfirmedMs": 769.0824760000105
        },
        {
          "localMs": 4,
          "frameMs": 6.899999999994179,
          "remoteObservedMs": 186.47302800000762,
          "serverConfirmedMs": 744.4084779999976
        },
        {
          "localMs": 3.2000000000116415,
          "frameMs": 25.400000000023283,
          "remoteObservedMs": 288.1691040000005,
          "serverConfirmedMs": 885.1786560000037
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1017853,
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
        "appendedBytes": 896003,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 896003,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 896337,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 896337,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 896337,
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
        "moduleStartMs": 32.5,
        "input": [],
        "moduleReadyMs": 88.5,
        "rowsReadyMs": 828.6000000000058,
        "rowsFrameMs": 834.7000000000116
      },
      "coldB": {
        "moduleStartMs": 50.29999999998836,
        "input": [],
        "moduleReadyMs": 92,
        "rowsReadyMs": 857.3999999999942,
        "rowsFrameMs": 864.0999999999767
      },
      "warmOffline": {
        "moduleStartMs": 19.800000000017462,
        "input": [],
        "moduleReadyMs": 54,
        "rowsReadyMs": 297.70000000001164,
        "rowsFrameMs": 300.70000000001164
      },
      "edits": [
        {
          "localMs": 7.100000000005821,
          "frameMs": 31.20000000001164,
          "remoteObservedMs": 191.54384199999913,
          "serverConfirmedMs": 726.5587360000063
        },
        {
          "localMs": 3.7000000000116415,
          "frameMs": 30.70000000001164,
          "remoteObservedMs": 300.849212000001,
          "serverConfirmedMs": 855.1076789999934
        },
        {
          "localMs": 4.899999999994179,
          "frameMs": 4.5,
          "remoteObservedMs": 287.7852989999956,
          "serverConfirmedMs": 834.4661510000005
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1018091,
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
        "appendedBytes": 896312,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 896312,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 896648,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 896648,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 896648,
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
      "bytes": 1017947,
      "importMs": 0.5999999999767169,
      "projectionMs": 113.79999999998836,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 1,
      "bytes": 1017947,
      "importMs": 1.2999999999883585,
      "projectionMs": 117.29999999998836,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 2,
      "bytes": 1017947,
      "importMs": 1.2999999999883585,
      "projectionMs": 178,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 0,
      "bytes": 896622,
      "importMs": 120.29999999998836,
      "projectionMs": 68.20000000001164,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 1,
      "bytes": 896622,
      "importMs": 114.60000000003492,
      "projectionMs": 68.89999999996508,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 2,
      "bytes": 896622,
      "importMs": 125.70000000001164,
      "projectionMs": 123.39999999996508,
      "allRowsMatch": true
    }
  ],
  "projectionComparison": [
    {
      "mode": "full",
      "repeat": 0,
      "editAndProjectionMs": 119.79999999998836,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 1,
      "editAndProjectionMs": 130.59999999997672,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 2,
      "editAndProjectionMs": 118.70000000001164,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 3,
      "editAndProjectionMs": 166,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 4,
      "editAndProjectionMs": 169.90000000002328,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "incremental",
      "repeat": 0,
      "editAndProjectionMs": 36.79999999998836,
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
      "editAndProjectionMs": 0.40000000002328306,
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
      "editAndProjectionMs": 0.6000000000349246,
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
      "editAndProjectionMs": 0.5,
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

## linux / yjs / webkit

```json
{
  "engine": "yjs",
  "browser": "webkit",
  "version": "26.6",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V45 96-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "f2d42594fa3ea82e73d61e5143b44655ac262ec0",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 30,
        "input": [],
        "moduleReadyMs": 68,
        "rowsReadyMs": 388,
        "rowsFrameMs": 422
      },
      "coldB": {
        "moduleStartMs": 18,
        "input": [],
        "moduleReadyMs": 47,
        "rowsReadyMs": 230,
        "rowsFrameMs": 262
      },
      "warmOffline": {
        "moduleStartMs": 9,
        "input": [],
        "moduleReadyMs": 22,
        "rowsReadyMs": 185,
        "rowsFrameMs": 210
      },
      "edits": [
        {
          "localMs": 41,
          "frameMs": 134,
          "remoteObservedMs": 54.41268900000068,
          "serverConfirmedMs": 1213.559268
        },
        {
          "localMs": 61,
          "frameMs": 64,
          "remoteObservedMs": 46.692580999999336,
          "serverConfirmedMs": 1115.288989999999
        },
        {
          "localMs": 40,
          "frameMs": 40,
          "remoteObservedMs": 29.520918000000165,
          "serverConfirmedMs": 1039.6434090000002
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683381
    },
    {
      "trial": 1,
      "coldA": {
        "moduleStartMs": 29,
        "input": [],
        "moduleReadyMs": 66,
        "rowsReadyMs": 383,
        "rowsFrameMs": 416
      },
      "coldB": {
        "moduleStartMs": 18,
        "input": [],
        "moduleReadyMs": 47,
        "rowsReadyMs": 269,
        "rowsFrameMs": 304
      },
      "warmOffline": {
        "moduleStartMs": 10,
        "input": [],
        "moduleReadyMs": 27,
        "rowsReadyMs": 186,
        "rowsFrameMs": 208
      },
      "edits": [
        {
          "localMs": 47,
          "frameMs": 58,
          "remoteObservedMs": 42.86447000000044,
          "serverConfirmedMs": 1071.0728179999987
        },
        {
          "localMs": 41,
          "frameMs": 44,
          "remoteObservedMs": 37.256147000000055,
          "serverConfirmedMs": 975.770833999999
        },
        {
          "localMs": 34,
          "frameMs": 35,
          "remoteObservedMs": 29.59084100000109,
          "serverConfirmedMs": 1008.1120279999996
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683482
    },
    {
      "trial": 2,
      "coldA": {
        "moduleStartMs": 34,
        "input": [],
        "moduleReadyMs": 71,
        "rowsReadyMs": 367,
        "rowsFrameMs": 398
      },
      "coldB": {
        "moduleStartMs": 19,
        "input": [],
        "moduleReadyMs": 49,
        "rowsReadyMs": 246,
        "rowsFrameMs": 277
      },
      "warmOffline": {
        "moduleStartMs": 12,
        "input": [],
        "moduleReadyMs": 37,
        "rowsReadyMs": 208,
        "rowsFrameMs": 236
      },
      "edits": [
        {
          "localMs": 37,
          "frameMs": 44,
          "remoteObservedMs": 31.628882999997586,
          "serverConfirmedMs": 991.1731409999993
        },
        {
          "localMs": 35,
          "frameMs": 38,
          "remoteObservedMs": 29.37137900000016,
          "serverConfirmedMs": 1076.1596360000003
        },
        {
          "localMs": 28,
          "frameMs": 37,
          "remoteObservedMs": 24.75857200000246,
          "serverConfirmedMs": 982.7714220000016
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1683585
    }
  ]
}
```

## linux / powersync / webkit

```json
{
  "engine": "powersync",
  "browser": "webkit",
  "version": "26.6",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V45 96-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "f2d42594fa3ea82e73d61e5143b44655ac262ec0",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 29,
        "input": [],
        "moduleReadyMs": 66,
        "rowsReadyMs": 2677,
        "rowsFrameMs": 2720
      },
      "coldB": {
        "moduleStartMs": 39,
        "input": [],
        "moduleReadyMs": 64,
        "rowsReadyMs": 4324,
        "rowsFrameMs": 4373
      },
      "warmOffline": {
        "moduleStartMs": 19,
        "input": [],
        "moduleReadyMs": 33,
        "rowsReadyMs": 945,
        "rowsFrameMs": 977
      },
      "edits": [
        {
          "localMs": 2015,
          "frameMs": 70,
          "remoteObservedMs": 2363.1897299999982,
          "serverConfirmedMs": 3892.222673999997
        },
        {
          "localMs": 3078,
          "frameMs": 19,
          "remoteObservedMs": 1846.9982269999964,
          "serverConfirmedMs": 4730.281616
        },
        {
          "localMs": 3153,
          "frameMs": 30,
          "remoteObservedMs": 1826.5009590000045,
          "serverConfirmedMs": 4524.811389000002
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
        "moduleReadyMs": 59,
        "rowsReadyMs": 2680,
        "rowsFrameMs": 2723
      },
      "coldB": {
        "moduleStartMs": 47,
        "input": [],
        "moduleReadyMs": 97,
        "rowsReadyMs": 5150,
        "rowsFrameMs": 5195
      },
      "warmOffline": {
        "moduleStartMs": 32,
        "input": [],
        "moduleReadyMs": 51,
        "rowsReadyMs": 955,
        "rowsFrameMs": 996
      },
      "edits": [
        {
          "localMs": 2089,
          "frameMs": 63,
          "remoteObservedMs": 1854.1887869999919,
          "serverConfirmedMs": 3503.8802679999935
        },
        {
          "localMs": 2986,
          "frameMs": 34,
          "remoteObservedMs": 2338.5118530000036,
          "serverConfirmedMs": 4375.2927409999975
        },
        {
          "localMs": 2940,
          "frameMs": 18,
          "remoteObservedMs": 1844.1521590000048,
          "serverConfirmedMs": 4323.292503000004
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
        "moduleReadyMs": 66,
        "rowsReadyMs": 2672,
        "rowsFrameMs": 2707
      },
      "coldB": {
        "moduleStartMs": 40,
        "input": [],
        "moduleReadyMs": 65,
        "rowsReadyMs": 5819,
        "rowsFrameMs": 5869
      },
      "warmOffline": {
        "moduleStartMs": 12,
        "input": [],
        "moduleReadyMs": 26,
        "rowsReadyMs": 656,
        "rowsFrameMs": 677
      },
      "edits": [
        {
          "localMs": 1899,
          "frameMs": 69,
          "remoteObservedMs": 1831.205494000009,
          "serverConfirmedMs": 3479.697180999996
        },
        {
          "localMs": 2877,
          "frameMs": 30,
          "remoteObservedMs": 1832.2592609999992,
          "serverConfirmedMs": 4479.3685759999935
        },
        {
          "localMs": 2572,
          "frameMs": 19,
          "remoteObservedMs": 1826.3168310000037,
          "serverConfirmedMs": 3869.320230000012
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1855898
    }
  ]
}
```

## linux / loro / webkit

```json
{
  "engine": "loro",
  "browser": "webkit",
  "version": "26.6",
  "platform": "linux",
  "release": "7.0.0-1017-azure",
  "cpu": "AMD EPYC 9V45 96-Core Processor",
  "cpuCount": 4,
  "memoryBytes": 16760344576,
  "node": "v24.22.1",
  "revision": "f2d42594fa3ea82e73d61e5143b44655ac262ec0",
  "samples": [
    {
      "trial": 0,
      "coldA": {
        "moduleStartMs": 54,
        "input": [],
        "moduleReadyMs": 175,
        "rowsReadyMs": 915,
        "rowsFrameMs": 932
      },
      "coldB": {
        "moduleStartMs": 30,
        "input": [],
        "moduleReadyMs": 149,
        "rowsReadyMs": 946,
        "rowsFrameMs": 963
      },
      "warmOffline": {
        "moduleStartMs": 21,
        "input": [],
        "moduleReadyMs": 88,
        "rowsReadyMs": 383,
        "rowsFrameMs": 396
      },
      "edits": [
        {
          "localMs": 11,
          "frameMs": 35,
          "remoteObservedMs": 205.49614900001325,
          "serverConfirmedMs": 723.3027250000159
        },
        {
          "localMs": 12,
          "frameMs": 22,
          "remoteObservedMs": 195.95951099999365,
          "serverConfirmedMs": 716.1153259999992
        },
        {
          "localMs": 11,
          "frameMs": 23,
          "remoteObservedMs": 202.1652639999811,
          "serverConfirmedMs": 716.8350579999969
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1018321,
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
        "appendedBytes": 896622,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 896622,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 896952,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 896952,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 896952,
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
        "moduleStartMs": 37,
        "input": [],
        "moduleReadyMs": 184,
        "rowsReadyMs": 1000,
        "rowsFrameMs": 1018
      },
      "coldB": {
        "moduleStartMs": 25,
        "input": [],
        "moduleReadyMs": 106,
        "rowsReadyMs": 894,
        "rowsFrameMs": 913
      },
      "warmOffline": {
        "moduleStartMs": 202,
        "input": [],
        "moduleReadyMs": 257,
        "rowsReadyMs": 540,
        "rowsFrameMs": 553
      },
      "edits": [
        {
          "localMs": 10,
          "frameMs": 33,
          "remoteObservedMs": 203.97897399999783,
          "serverConfirmedMs": 714.2354930000147
        },
        {
          "localMs": 9,
          "frameMs": 30,
          "remoteObservedMs": 192.39059199998155,
          "serverConfirmedMs": 692.3927289999847
        },
        {
          "localMs": 10,
          "frameMs": 29,
          "remoteObservedMs": 195.54298600001493,
          "serverConfirmedMs": 715.3129450000124
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1018557,
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
        "appendedBytes": 896925,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 896925,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 897255,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 897255,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 897255,
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
        "moduleStartMs": 42,
        "input": [],
        "moduleReadyMs": 172,
        "rowsReadyMs": 919,
        "rowsFrameMs": 938
      },
      "coldB": {
        "moduleStartMs": 23,
        "input": [],
        "moduleReadyMs": 116,
        "rowsReadyMs": 903,
        "rowsFrameMs": 921
      },
      "warmOffline": {
        "moduleStartMs": 35,
        "input": [],
        "moduleReadyMs": 90,
        "rowsReadyMs": 380,
        "rowsFrameMs": 393
      },
      "edits": [
        {
          "localMs": 10,
          "frameMs": 31,
          "remoteObservedMs": 307.0257589999819,
          "serverConfirmedMs": 804.0168290000001
        },
        {
          "localMs": 14,
          "frameMs": 34,
          "remoteObservedMs": 212.23377700001583,
          "serverConfirmedMs": 742.0981540000066
        },
        {
          "localMs": 12,
          "frameMs": 21,
          "remoteObservedMs": 197.43102400001953,
          "serverConfirmedMs": 710.5567990000127
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1018769,
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
        "appendedBytes": 897228,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 897228,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 897558,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 897558,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 897558,
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
      "bytes": 1018633,
      "importMs": 1,
      "projectionMs": 173,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 1,
      "bytes": 1018633,
      "importMs": 2,
      "projectionMs": 158,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 2,
      "bytes": 1018633,
      "importMs": 2,
      "projectionMs": 163,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 0,
      "bytes": 897531,
      "importMs": 182,
      "projectionMs": 89,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 1,
      "bytes": 897531,
      "importMs": 130,
      "projectionMs": 93,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 2,
      "bytes": 897531,
      "importMs": 129,
      "projectionMs": 93,
      "allRowsMatch": true
    }
  ],
  "projectionComparison": [
    {
      "mode": "full",
      "repeat": 0,
      "editAndProjectionMs": 163,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 1,
      "editAndProjectionMs": 161,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 2,
      "editAndProjectionMs": 158,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 3,
      "editAndProjectionMs": 234,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 4,
      "editAndProjectionMs": 161,
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
      "editAndProjectionMs": 6,
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
      "editAndProjectionMs": 6,
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
```

## win32 / loro / webkit

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
        "moduleStartMs": 97,
        "input": [],
        "moduleReadyMs": 233,
        "rowsReadyMs": 26809,
        "rowsFrameMs": 26848
      },
      "coldB": {
        "moduleStartMs": 71,
        "input": [],
        "moduleReadyMs": 233,
        "rowsReadyMs": 26783,
        "rowsFrameMs": 26823
      },
      "warmOffline": {
        "moduleStartMs": 55,
        "input": [],
        "moduleReadyMs": 180,
        "rowsReadyMs": 1057,
        "rowsFrameMs": 1076
      },
      "edits": [
        {
          "localMs": 66,
          "frameMs": 47,
          "remoteObservedMs": 370.0310000000027,
          "serverConfirmedMs": 1114.7406000000046
        },
        {
          "localMs": 54,
          "frameMs": 36,
          "remoteObservedMs": 343.5984000000026,
          "serverConfirmedMs": 1056.7456999999995
        },
        {
          "localMs": 63,
          "frameMs": 61,
          "remoteObservedMs": 390.6000000000058,
          "serverConfirmedMs": 1130.4391999999934
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1020331,
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
        "appendedBytes": 899163,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 899163,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 899493,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 899493,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 899493,
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
        "moduleReadyMs": 183,
        "rowsReadyMs": 18622,
        "rowsFrameMs": 18676
      },
      "coldB": {
        "moduleStartMs": 54,
        "input": [],
        "moduleReadyMs": 181,
        "rowsReadyMs": 21844,
        "rowsFrameMs": 21890
      },
      "warmOffline": {
        "moduleStartMs": 51,
        "input": [],
        "moduleReadyMs": 190,
        "rowsReadyMs": 941,
        "rowsFrameMs": 966
      },
      "edits": [
        {
          "localMs": 53,
          "frameMs": 33,
          "remoteObservedMs": 344.5720999999903,
          "serverConfirmedMs": 1021.4182999999903
        },
        {
          "localMs": 52,
          "frameMs": 49,
          "remoteObservedMs": 343.6941999999981,
          "serverConfirmedMs": 951.7608999999939
        },
        {
          "localMs": 55,
          "frameMs": 38,
          "remoteObservedMs": 237.37219999998342,
          "serverConfirmedMs": 904.0160999999789
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1020528,
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
        "appendedBytes": 899466,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 899466,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 899796,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 899796,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 899796,
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
        "moduleStartMs": 71,
        "input": [],
        "moduleReadyMs": 184,
        "rowsReadyMs": 18876,
        "rowsFrameMs": 18911
      },
      "coldB": {
        "moduleStartMs": 57,
        "input": [],
        "moduleReadyMs": 203,
        "rowsReadyMs": 24754,
        "rowsFrameMs": 24793
      },
      "warmOffline": {
        "moduleStartMs": 51,
        "input": [],
        "moduleReadyMs": 178,
        "rowsReadyMs": 1056,
        "rowsFrameMs": 1086
      },
      "edits": [
        {
          "localMs": 62,
          "frameMs": 44,
          "remoteObservedMs": 370.48119999998016,
          "serverConfirmedMs": 998.5887999999977
        },
        {
          "localMs": 50,
          "frameMs": 29,
          "remoteObservedMs": 360.66380000000936,
          "serverConfirmedMs": 1268.1361000000034
        },
        {
          "localMs": 52,
          "frameMs": 49,
          "remoteObservedMs": 343.46489999999176,
          "serverConfirmedMs": 1013.6655000000028
        }
      ],
      "rows": 10000,
      "storageRepresentationBytes": 1020735,
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
        "appendedBytes": 899769,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 1,
        "journalBytes": 899769,
        "compactionFailures": 0
      },
      "persistenceAfter": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 900099,
        "compactions": 0,
        "checkpointExports": 0,
        "journalCount": 4,
        "journalBytes": 900099,
        "compactionFailures": 0
      },
      "persistenceCompacted": {
        "appendTransactions": 7,
        "appendedUpdates": 4,
        "appendedBytes": 900099,
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
      "bytes": 1020561,
      "importMs": 1,
      "projectionMs": 846,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 1,
      "bytes": 1020561,
      "importMs": 25,
      "projectionMs": 1271,
      "allRowsMatch": true
    },
    {
      "mode": "snapshot",
      "repeat": 2,
      "bytes": 1020561,
      "importMs": 40,
      "projectionMs": 1660,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 0,
      "bytes": 900072,
      "importMs": 28986,
      "projectionMs": 157,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 1,
      "bytes": 900072,
      "importMs": 13469,
      "projectionMs": 122,
      "allRowsMatch": true
    },
    {
      "mode": "update",
      "repeat": 2,
      "bytes": 900072,
      "importMs": 13983,
      "projectionMs": 137,
      "allRowsMatch": true
    }
  ],
  "projectionComparison": [
    {
      "mode": "full",
      "repeat": 0,
      "editAndProjectionMs": 287,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 1,
      "editAndProjectionMs": 295,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 2,
      "editAndProjectionMs": 263,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 3,
      "editAndProjectionMs": 269,
      "allRowsMatch": true,
      "indexedRows": 10000
    },
    {
      "mode": "full",
      "repeat": 4,
      "editAndProjectionMs": 2411,
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
      "editAndProjectionMs": 103,
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
      "editAndProjectionMs": 8,
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
      "editAndProjectionMs": 96,
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
