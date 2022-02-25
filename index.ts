import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { exit } from "process";
import axios from "axios";

const execAsync = promisify(exec);

const INPUT_DIR = process.env["INPUT_DIR"] || "input/";
const OUTPUT_DIR = process.env["OUTPUT_DIR"] || "output/";
const CONTAINER = process.env["CONTAINER"] as string;
const CHECKER_URL = process.env["CHECKER_URL"] as string;

const MULTI_SIG_TRANSITION_PREFIX = "T_";

const isLowerCase = (c) => c === c.toLowerCase();

const abort = () => {
  console.log("⛔️ Abort contract generation");
  exit(1);
};
const waitFor = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(() => resolve(undefined), ms);
  });
};

const checkWithAPI = async (src) => {
  try {
    const code = fs.readFileSync(src).toString();
    const res = await axios.post(CHECKER_URL, { code });
    return JSON.parse(res.data.message);
  } catch (error: any) {
    throw new Error(
      error.response?.data?.message
        ? JSON.stringify(error.response.data.message)
        : error
    );
  }
};

const checkWithContainer = async (container, src) => {
  const contractFilename = src.split("/").pop();
  const scillaPath = "/scilla/0/";
  const paths = {
    checker: `${scillaPath}bin/scilla-checker`,
    stdlib: `${scillaPath}src/stdlib`,
    dest: `${scillaPath}${contractFilename}`,
  };

  await execAsync(`docker cp ${src} ${container}:${paths.dest}`);

  const cmd = [
    "docker exec",
    container,
    paths.checker,
    "-libdir",
    paths.stdlib,
    "-gaslimit",
    "999999999",
    paths.dest,
    "-contractinfo",
  ].join(" ");

  const res = await execAsync(cmd);
  const msg = JSON.parse(res.stdout);
  return msg;
};

const checkContract = async (container, src) => {
  try {
    if (container !== undefined) {
      return await checkWithContainer(container, src);
    }
    return await checkWithAPI(src);
  } catch (error) {
    console.error(error);
    console.log(`❌ Failed to check: ${src}`);
    abort();
  }
};

const getTransitionNames = (code) => {
  const names = [] as string[];
  let enabled = false;

  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "(* @multi-sig *)") {
      enabled = true;
      continue;
    }

    if (enabled && lines[i].startsWith("transition")) {
      const name = lines[i].split(" ")[1].split("(")[0];
      names.push(name);
      enabled = false;
    }
  }
  return names;
};

const getTypeDef = (transtions) => {
  const arms = Object.keys(transtions).map((transitionName) => {
    const prefix = isLowerCase(transitionName[0])
      ? MULTI_SIG_TRANSITION_PREFIX
      : "";
    const params = transtions[transitionName];
    const struct =
      params.length === 0
        ? ""
        : ` of ${params
            .map((x) => "(" + x.type + ")")
            .join(" ")
            .trim()}`;
    return `| ${prefix}${transitionName}${struct}`;
  });

  const pre = `type MultiSigTransition = \n  `;
  const result = `${pre}${arms.join("\n  ")}`;
  return result;
};

const getMsgFnDef = (transtions) => {
  const arms = Object.keys(transtions).map((key) => {
    const vnames = transtions[key].filter((x) => x).map((x) => x.vname);
    const prefix = isLowerCase(key[0]) ? MULTI_SIG_TRANSITION_PREFIX : "";
    const params =
      vnames.length === 0
        ? ""
        : `\n      ${vnames
            .map((x) => `      ${x}: ${x}`)
            .join(";\n")
            .trim()};`;

    return `| ${prefix}${key}${
      vnames.length === 0 ? "" : " " + vnames.join(" ").trim()
    } => {${params}\n      _tag: "${key}"; _amount: Uint128 0; _recipient: r\n    }`;
  });

  const pre = `let custom_transaction_msg = fun (r: ByStr20) => fun (t: MultiSigTransition) => let msg = match t with \n  `;
  const post = `\n  end in one_msg msg`;
  const result = pre + arms.join("\n  ") + post;
  return result;
};

const genCodes = async (containerName, codePaths) => {
  const allowlist = codePaths
    .map((path) => fs.readFileSync(path).toString())
    .map((code) => getTransitionNames(code))
    .flat()
    .filter((v, i, self) => self.indexOf(v) === i);

  const transitions = (
    await Promise.all(
      codePaths.map((path) => checkContract(containerName, path))
    )
  )
    .map((x) => x.contract_info.transitions)
    .flat()
    .filter((cur) => allowlist.includes(cur.vname))
    .map((cur) => {
      const { vname, params } = cur;
      const p = params.map((x) => ({
        vname: x.vname,
        type: x.type.startsWith("ByStr") ? x.type.split(" ")[0] : x.type,
      }));
      return { vname, params: p };
    })
    .reduce((acc, cur) => {
      const { vname, params } = cur;
      acc[vname] = params;
      return acc;
    }, {});

  return Object.keys(transitions).length === 0
    ? undefined
    : getTypeDef(transitions) + "\n\n" + getMsgFnDef(transitions);
};

const mergeCodes = (template, code) => {
  const lines = template.split("\n");
  const startLine = "(* --- gen start --- *)";
  const startLineIndex = lines.findIndex((l) => l === startLine);
  const genIndex = startLineIndex + 1;
  if (genIndex === -1) {
    throw Error(`${startLine} is not fonud`);
  }
  const output = [
    ...lines.slice(0, genIndex),
    code,
    ...lines.slice(genIndex),
  ].join("\n");
  return output;
};

const genContract = async (
  containerName,
  template,
  inputContractPaths,
  outputPath
) => {
  const codes = await genCodes(containerName, inputContractPaths);
  if (codes === undefined) {
    return;
  }
  const output = mergeCodes(template, codes);
  fs.writeFileSync(outputPath, output);
  await checkContract(containerName, outputPath);
};

const mswTemplate = `(* SPDX-License-Identifier: GPL-3.0 *)
scilla_version 0

(***************************************************)
(*               Associated library                *)
(***************************************************)

import ListUtils BoolUtils
library MultiSigWallet

let one_msg =
  fun (msg : Message) =>
    let nil_msg = Nil {Message} in
    Cons {Message} msg nil_msg

(* --- gen start --- *)
(* --- gen end --- *)

let true = True
let zero_uint32 = Uint32 0
let one_uint32 = Uint32 1

type Transaction =
  | NativeTransaction of ByStr20 Uint128 String
  | CustomTransaction of ByStr20 MultiSigTransition

type Error =
  | NotAllowedToSignError
  | NotAllowedToExecuteError
  | NotAllowedToSubmitError
  | TransactionNotFoundError
  | SigNotFoundError
  | SigFoundError
  | NotEnoughSigCountError
  | InsufficientFundsError
  | InvalidAmountError
  | InconsistentSigCountError

let make_error =
fun (result: Error) =>
  let result_code =
    match result with
    | NotAllowedToSignError     => Int32 -1
    | NotAllowedToExecuteError  => Int32 -2
    | NotAllowedToSubmitError   => Int32 -3
    | TransactionNotFoundError  => Int32 -4
    | SigNotFoundError          => Int32 -5
    | SigFoundError             => Int32 -6
    | NotEnoughSigCountError    => Int32 -7
    | InsufficientFundsError    => Int32 -8
    | InvalidAmountError        => Int32 -9
    | InconsistentSigCountError => Int32 -10
    end
  in
  { _exception: "Error"; code: result_code }

(* Make map of owners *)
let make_owners_map =
  fun (owners: List ByStr20) =>
    let init = Emp ByStr20 Bool in
    let iter =
      fun (acc: Map ByStr20 Bool) =>
      fun (cur_owner: ByStr20) =>
        (* Add owner unconditionally. We check for duplicates later *)
        builtin put acc cur_owner true in
    let folder = @list_foldl ByStr20 (Map ByStr20 Bool) in
    folder iter init owners

contract MultiSigWallet
(
  owner_list: List ByStr20,
  num_of_required_signatures: Uint32
)
with
  let len = @list_length ByStr20 in
  let no_of_owners = len owner_list in
  let owners_ok = builtin lt zero_uint32 no_of_owners in
  let required_sigs_not_too_low = builtin lt zero_uint32 num_of_required_signatures in
  let required_sigs_too_high = builtin lt no_of_owners num_of_required_signatures in
  let required_sigs_not_too_high = negb required_sigs_too_high in
  let required_sigs_ok = andb required_sigs_not_too_high required_sigs_not_too_low in
  let all_ok = andb required_sigs_ok owners_ok in
  (* Building the owners map is expensive, so avoid checking the owners map until *)
  (* everything else has been checked *)
  match all_ok with
  | True =>
    let owners_map = make_owners_map owner_list in
    let size_of_owners_map = builtin size owners_map in
    builtin eq size_of_owners_map no_of_owners
  | False =>
    False
  end
=>

field owners: Map ByStr20 Bool = make_owners_map owner_list

field transaction_count: Uint32 = Uint32 0

field transactions: Map Uint32 Transaction = Emp Uint32 Transaction

field signatures: Map Uint32 (Map ByStr20 Bool) = Emp Uint32 (Map ByStr20 Bool)

field signature_counts: Map Uint32 Uint32 = Emp Uint32 Uint32

procedure Throw(err: Error)
  e = make_error err;
  throw e
end

procedure AddSignature(transaction_id: Uint32, signee: ByStr20)
  has_sig <- exists signatures[transaction_id][signee];
  match has_sig with
  | True =>
    err = SigFoundError;
    Throw err
  | False =>
    maybe_count <- signature_counts[transaction_id];
    match maybe_count with
    | None =>
      (* 0 signatures *)
      signature_counts[transaction_id] := one_uint32
    | Some count =>
      new_count = builtin add count one_uint32;
      signature_counts[transaction_id] := new_count
    end;

    signatures[transaction_id][signee] := true;
    
    e = { _eventname: "AddSignature"; transaction_id: transaction_id };
    event e
  end
end

procedure SubmitTransaction(transaction: Transaction)
  is_owner <- exists owners[_sender];
  match is_owner with
  | False =>
    err = NotAllowedToSubmitError;
    Throw err
  | True =>
    count <- transaction_count;
    transactions[count] := transaction;
    
    (* Sender implicitly signs *)
    AddSignature count _sender;
    
    new_count = builtin add count one_uint32;
    transaction_count := new_count;
  
    e = { _eventname: "SubmitTransaction"; transaction_id: count };
    event e
  end
end

procedure DeleteTransaction(transaction_id: Uint32)
  delete transactions[transaction_id];
  delete signatures[transaction_id];
  delete signature_counts[transaction_id]
end

procedure ExecuteNativeTransaction(recipient: ByStr20, amount: Uint128, tag: String)
  (* Only the recipient or an owner can execute the transaction *)
  recipient_is_sender = builtin eq recipient _sender;
  is_owner <- exists owners[_sender];
  is_allowed = orb recipient_is_sender is_owner;
  match is_allowed with
  | False =>
    err = NotAllowedToExecuteError;
    Throw err
  | True =>
    (* Check for sufficient funds  *)
    bal <- _balance;
    is_not_enough = builtin lt bal amount;
    match is_not_enough with
    | True =>
      err = InsufficientFundsError;
      Throw err
    | False =>
      (* Transaction approved, and enough money available. *)
      (* Execute transaction *)
      msg = { _tag: tag; _recipient: recipient; _amount: amount };
      msgs = one_msg msg;
      send msgs
    end
  end
end

procedure ExecuteCustomTransaction(contract_address: ByStr20, transaction: MultiSigTransition)
  (* Only owners may execute *)
  is_owner <- exists owners[_sender];
  match is_owner with
  | False =>
    err = NotAllowedToExecuteError;
    Throw err
  | True =>
    msg = custom_transaction_msg contract_address transaction;
    send msg
  end
end

transition SubmitNativeTransaction(recipient: ByStr20, amount: Uint128, tag: String)
  zero_uint128 = Uint128 0;
  is_zero = builtin eq amount zero_uint128;
  match is_zero with
  | True =>
    err = InvalidAmountError;
    Throw err
  | False =>
    transaction = NativeTransaction recipient amount tag;
    SubmitTransaction transaction
  end
end

transition SubmitCustomTransaction(contract_address: ByStr20, transaction: MultiSigTransition)
  tx = CustomTransaction contract_address transaction;
  SubmitTransaction tx
end

transition SignTransaction(transaction_id: Uint32)
  (* Only owners are allowed to sign off transactions *)
  is_owner <- exists owners[_sender];
  match is_owner with
  | False =>
    err = NotAllowedToSignError;
    Throw err
  | True =>
    (* Transaction must have been submitted *)
    has_transaction <- exists transactions[transaction_id];
    match has_transaction with
    | False =>
      err = TransactionNotFoundError;
      Throw err
    | True =>
      AddSignature transaction_id _sender
    end
  end
end

transition RevokeSignature(transaction_id: Uint32)
  has_sig <- exists signatures[transaction_id][_sender];
  match has_sig with
  | False =>
    err = SigNotFoundError;
    Throw err
  | True =>
    maybe_count <- signature_counts[transaction_id];
    match maybe_count with
    | None =>
      err = InconsistentSigCountError;
      Throw err
    | Some count =>
      is_zero = builtin eq count zero_uint32;
      match is_zero with
      | True =>
        err = InconsistentSigCountError;
        Throw err
      | False =>
        new_count = builtin sub count one_uint32;
        signature_counts[transaction_id] := new_count;
        
        delete signatures[transaction_id][_sender];

        e = { _eventname: "RevokeSignature"; transaction_id: transaction_id };
        event e
      end
    end
  end
end

transition ExecuteTransaction(transaction_id: Uint32)
  maybe_transaction <- transactions[transaction_id];
  match maybe_transaction with
  | None =>
    err = TransactionNotFoundError;
    Throw err
  | Some transaction =>
    maybe_sig_count <- signature_counts[transaction_id];
    match maybe_sig_count with
    | None =>
      (* Signature count not found, even though the transaction exists. *)
      err = InconsistentSigCountError;
      Throw err
    | Some sig_count =>
      not_enough_signatures = builtin lt sig_count num_of_required_signatures;
      match not_enough_signatures with
      | True =>
        err = NotEnoughSigCountError;
        Throw err
      | False =>
        match transaction with
        | NativeTransaction recipient amount tag =>
          ExecuteNativeTransaction recipient amount tag
        | CustomTransaction contract_address transaction =>
          ExecuteCustomTransaction contract_address transaction
        end;
        (* Remove transaction and signatures. *)
        (* Note: The transaction may have failed, but without a callback *)
        (* we have no way of detecting whether it did *)
        DeleteTransaction transaction_id
      end
    end
  end
end

transition AddFunds()
  accept;
  e = { _eventname: "AddFunds"; sender: _sender; amount: _amount };
  event e
end
`;

const directoryPath = path.join(__dirname, INPUT_DIR);

(async () => {
  console.log("🚀 Start contract generation");

  if (CONTAINER !== undefined) {
    const maxAttempts = 5;
    const delay = 3000; // Millisecond

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await execAsync(
          `docker container inspect --format='{{.State.Running}}' ${CONTAINER}`
        );

        if (res.stdout.includes("true")) {
          break;
        }
      } catch (error) {
        console.error(error);
      }

      if (i === 0) {
        console.log(`🐳 Container ${CONTAINER} is not running yet`);
      }

      console.log(`✨ Tries: (${i + 1}/${maxAttempts})`);

      if (i === maxAttempts - 1) {
        console.log(`❌ Container ${CONTAINER} is not running`);
        abort();
      }
      console.log(`⏳ Retrying in ${delay} ms`);
      await waitFor(delay);
    }
  }

  fs.readdir(directoryPath, async function (error, files) {
    if (error) {
      throw new Error(error.message);
    }
    const inputContracts = files.filter((x) => x.split(".").pop() === "scilla");
    console.log(
      `📃 Input Contracts (total: ${inputContracts.length}):\n`,
      inputContracts.join("\n ")
    );

    const inputPaths = inputContracts.map((file) => INPUT_DIR + file);
    const outputPath = OUTPUT_DIR + "msw.scilla";

    await genContract(CONTAINER, mswTemplate, inputPaths, outputPath);
    console.log("✅ Success: " + OUTPUT_DIR + "msw.scilla");
  });
})();
