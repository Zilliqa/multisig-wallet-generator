<div align="center">
  <h1>
  Zilliqa Multi-Sig Wallet Generator
  </h1>
  <strong>
  Generates a multi-sig wallet contract for your use case
  </strong>
</div>
<hr/>
<div>
  <a href="https://app.travis-ci.com/Zilliqa/multisig-wallet-generator" target="_blank">
  <img src="https://app.travis-ci.com/Zilliqa/multisig-wallet-generator.svg?token=6BrmjBEqdaGp73khUJCz&branch=main" />
  </a>
  <a href="LICENSE" target="_blank">
  <img src="https://img.shields.io/badge/License-GPLv3-blue.svg" />
  </a>
</div>

## Prerequisites

- [Docker](https://www.docker.com)
- [Node.js](https://nodejs.org/en/)

## Installation

### `npm i`

Installs the dependencies.

## Usage

### Step 1. Annotate your transitions: `(* @multi-sig *)`

e.g.

foo.scilla

```ocaml
(* @multi-sig *)
(* Pauses the contract. Use this when things are going wrong ('circuit breaker'). *)
transition Pause()
  RequireNotPaused;
  RequireContractOwner;

  is_paused := true;
  e = {
    _eventname: "Pause";
    is_paused: true
  };
  event e
end

```

### Step 2. Put your contracts in `input/`

e.g.

```
input/foo.scilla
input/bar.scilla
input/baz.scilla
```

### Step 3. Run `npm run gen`

Generates your multi-sig wallet contract: `output/msw.scilla` by default.

During the contract generation, it makes API calls to `https://scilla-server.zilliqa.com/contract/check`.

To avoid this behavior, run `npm run gen:docker`. It uses [Isolated Server container](https://hub.docker.com/r/zilliqa/zilliqa-isolated-server) instead.

## Environment Variables

| Name          | Description                                                          | Default Value |
| ------------- | -------------------------------------------------------------------- | ------------- |
| `INPUT_DIR`   | A folder for the input contract with `(* @multi-sig *)` annotations. | `input/`      |
| `OUTPUT_DIR`  | A folder for the generated multi-sig wallet contract.                | `output/`     |
| `PORT`        | The port of Isolated Server container.                               | `5555`        |
| `CONTAINER`   | The name of Isolated Server container.                               |               |
| `CHECKER_URL` | The URL of Scilla Checker API.                                       |               |

## Contract Testing

### `npm test`

Runs contract tests using [Isolated Server container](https://hub.docker.com/r/zilliqa/zilliqa-isolated-server), [Jest](https://jestjs.io/), and [Scilla JSON Utils](https://github.com/Zilliqa/scilla-json-utils)

## Constructing the parameters of `SubmitCustomTransaction`

MultiSigTransition ADT

```ocaml
type MultiSigTransition =
  | Allow of (List (ByStr20))
  | Disallow of (List (ByStr20))
```

Example parameters

```json
[
  {
    "type": "ByStr20",
    "value": "0x0c4769cddb5e54683126c33b116c5ff9765c2ac3",
    "vname": "contract_address"
  },
  {
    "type": "0xf6241e9d6b033847e814e6cc7022fa1360fe4fe3.MultiSigTransition",
    "value": {
      "argtypes": [],
      "arguments": [
        [
          "0x268fb34ad21aa21b02ff9ad77f29d2f08dabeb93",
          "0xa3755a10dba7bbe77770c620041b442c624be0a1"
        ]
      ],
      "constructor": "0xf6241e9d6b033847e814e6cc7022fa1360fe4fe3.Allow"
    },
    "vname": "transaction"
  }
]
```

_Consider using [Scilla JSON Utils](https://github.com/Zilliqa/scilla-json-utils) to construct the above JSON values._

## License

This project is open source software licensed as [GPL-3.0](./LICENSE).
