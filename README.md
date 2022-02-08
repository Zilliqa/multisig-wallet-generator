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
  <a href="https://app.travis-ci.com/Zilliqa/msw-gen" target="_blank">
  <img src="https://app.travis-ci.com/Zilliqa/msw-gen.svg?token=6BrmjBEqdaGp73khUJCz&branch=main" />
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

Generates your multi-sig wallet contract: `output/msw.scilla`

## Contract Testing

### `npm test`

Runs contract tests using [Isolated Server container](https://hub.docker.com/r/zilliqa/zilliqa-isolated-server), [Jest](https://jestjs.io/), and [Scilla JSON Utils](https://github.com/Zilliqa/scilla-json-utils)

## License

This project is open source software licensed as [GPL-3.0](./LICENSE).
