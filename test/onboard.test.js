// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildSandboxConfigSyncScript,
  getFutureShellPathHint,
  getInstalledOpenshellVersion,
  getStableGatewayImageRef,
  pruneStaleSandboxEntry,
  runCaptureOpenshell,
  writeSandboxConfigSyncFile,
} from "../bin/lib/onboard";

describe("onboard helpers", () => {
  it("builds a sandbox sync script that only writes nemoclaw config", () => {
    const script = buildSandboxConfigSyncScript({
      endpointType: "custom",
      endpointUrl: "https://inference.local/v1",
      ncpPartner: null,
      model: "nemotron-3-nano:30b",
      profile: "inference-local",
      credentialEnv: "OPENAI_API_KEY",
      onboardedAt: "2026-03-18T12:00:00.000Z",
    });

    expect(script).toMatch(/cat > ~\/\.nemoclaw\/config\.json/);
    expect(script).toMatch(/"model": "nemotron-3-nano:30b"/);
    expect(script).toMatch(/"credentialEnv": "OPENAI_API_KEY"/);
    expect(script).not.toMatch(/openclaw\.json/);
    expect(script).not.toMatch(/openclaw models set/);
    expect(script).toMatch(/^exit$/m);
  });

  it("pins the gateway image to the installed OpenShell release version", () => {
    expect(getInstalledOpenshellVersion("openshell 0.0.12")).toBe("0.0.12");
    expect(getInstalledOpenshellVersion("openshell 0.0.13-dev.8+gbbcaed2ea")).toBe("0.0.13");
    expect(getInstalledOpenshellVersion("bogus")).toBe(null);
    expect(getStableGatewayImageRef("openshell 0.0.12")).toBe("ghcr.io/nvidia/openshell/cluster:0.0.12");
    expect(getStableGatewayImageRef("openshell 0.0.13-dev.8+gbbcaed2ea")).toBe("ghcr.io/nvidia/openshell/cluster:0.0.13");
    expect(getStableGatewayImageRef("bogus")).toBe(null);
  });

  it("returns a future-shell PATH hint for user-local openshell installs", () => {
    expect(getFutureShellPathHint("/home/test/.local/bin", "/usr/local/bin:/usr/bin")).toBe(
      'export PATH="/home/test/.local/bin:$PATH"'
    );
  });

  it("skips the future-shell PATH hint when the bin dir is already on PATH", () => {
    expect(
      getFutureShellPathHint("/home/test/.local/bin", "/home/test/.local/bin:/usr/local/bin:/usr/bin")
    ).toBe(null);
  });

  it("writes sandbox sync scripts to a temp file for stdin redirection", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-test-"));
    try {
      const scriptFile = writeSandboxConfigSyncFile("echo test", tmpDir, 1234);
      expect(scriptFile).toBe(path.join(tmpDir, "nemoclaw-sync-1234.sh"));
      expect(fs.readFileSync(scriptFile, "utf8")).toBe("echo test\n");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("passes credential names to openshell without embedding secret values in argv", () => {
    const repoRoot = path.join(__dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-inference-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-inference-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

    const script = String.raw`
const runner = require(${runnerPath});
const registry = require(${registryPath});

const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command, env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (command.includes("inference") && command.includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: nvidia-nim",
      "  Model: nvidia/nemotron-3-super-120b-a12b",
      "  Version: 1",
    ].join("\\n");
  }
  return "";
};
registry.updateSandbox = () => true;

process.env.NVIDIA_API_KEY = "nvapi-secret-value";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "nvidia/nemotron-3-super-120b-a12b", "nvidia-nim");
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    expect(result.status).toBe(0);
    const commands = JSON.parse(result.stdout.trim().split("\n").pop());
    assert.equal(commands.length, 3);
    assert.match(commands[0].command, /gateway' 'select' 'nemoclaw'/);
    assert.match(commands[1].command, /'--credential' 'NVIDIA_API_KEY'/);
    assert.doesNotMatch(commands[1].command, /nvapi-secret-value/);
    assert.match(commands[1].command, /provider' 'create'/);
    assert.match(commands[2].command, /inference' 'set'/);
  });

  it("uses native Anthropic provider creation without embedding the secret in argv", () => {
    const repoRoot = path.join(__dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-anthropic-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-anthropic-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

    const script = String.raw`
const runner = require(${runnerPath});
const registry = require(${registryPath});

const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command, env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (command.includes("inference") && command.includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: anthropic-prod",
      "  Model: claude-sonnet-4-5",
      "  Version: 1",
    ].join("\n");
  }
  return "";
};
registry.updateSandbox = () => true;

process.env.ANTHROPIC_API_KEY = "sk-ant-secret-value";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "claude-sonnet-4-5", "anthropic-prod", "https://api.anthropic.com", "ANTHROPIC_API_KEY");
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const commands = JSON.parse(result.stdout.trim().split("\n").pop());
    assert.equal(commands.length, 3);
    assert.match(commands[0].command, /gateway' 'select' 'nemoclaw'/);
    assert.match(commands[1].command, /'--type' 'anthropic'/);
    assert.match(commands[1].command, /'--credential' 'ANTHROPIC_API_KEY'/);
    assert.doesNotMatch(commands[1].command, /sk-ant-secret-value/);
    assert.match(commands[2].command, /'--provider' 'anthropic-prod'/);
  });

  it("updates OpenAI-compatible providers without passing an unsupported --type flag", () => {
    const repoRoot = path.join(__dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-openai-update-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "setup-openai-update-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

    const script = String.raw`
const runner = require(${runnerPath});
const registry = require(${registryPath});

const commands = [];
let callIndex = 0;
runner.run = (command, opts = {}) => {
  commands.push({ command, env: opts.env || null });
  callIndex += 1;
  return { status: callIndex === 2 ? 1 : 0 };
};
runner.runCapture = (command) => {
  if (command.includes("inference") && command.includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: openai-api",
      "  Model: gpt-5.4",
      "  Version: 1",
    ].join("\n");
  }
  return "";
};
registry.updateSandbox = () => true;

process.env.OPENAI_API_KEY = "sk-secret-value";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "gpt-5.4", "openai-api", "https://api.openai.com/v1", "OPENAI_API_KEY");
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const commands = JSON.parse(result.stdout.trim().split("\n").pop());
    assert.equal(commands.length, 4);
    assert.match(commands[0].command, /gateway' 'select' 'nemoclaw'/);
    assert.match(commands[1].command, /provider' 'create'/);
    assert.match(commands[2].command, /provider' 'update' 'openai-api'/);
    assert.doesNotMatch(commands[2].command, /'--type'/);
    assert.match(commands[3].command, /inference' 'set' '--no-verify'/);
  });

  it("drops stale local sandbox registry entries when the live sandbox is gone", () => {
    const repoRoot = path.join(__dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-stale-sandbox-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "stale-sandbox-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "onboard.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "registry.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "runner.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

    const script = String.raw`
const registry = require(${registryPath});
const runner = require(${runnerPath});
runner.runCapture = (command) => (command.includes("'sandbox' 'get' 'my-assistant'") ? "" : "");

registry.registerSandbox({ name: "my-assistant" });

const { pruneStaleSandboxEntry } = require(${onboardPath});

const liveExists = pruneStaleSandboxEntry("my-assistant");
console.log(JSON.stringify({ liveExists, sandbox: registry.getSandbox("my-assistant") }));
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim().split("\n").pop());
    assert.equal(payload.liveExists, false);
    assert.equal(payload.sandbox, null);
  });

  it("accepts gateway inference when system inference is separately not configured", () => {
    const repoRoot = path.join(__dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-inference-get-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "inference-get-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

    const script = String.raw`
const runner = require(${runnerPath});
const registry = require(${registryPath});
const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command, env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (command.includes("inference") && command.includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Route: inference.local",
      "  Provider: openai-api",
      "  Model: gpt-5.4",
      "  Version: 1",
      "",
      "System inference:",
      "",
      "  Not configured",
    ].join("\\n");
  }
  return "";
};
registry.updateSandbox = () => true;
process.env.OPENAI_API_KEY = "sk-secret-value";
process.env.OPENSHELL_GATEWAY = "nemoclaw";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "gpt-5.4", "openai-api", "https://api.openai.com/v1", "OPENAI_API_KEY");
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const commands = JSON.parse(result.stdout.trim().split("\n").pop());
    assert.equal(commands.length, 3);
  });

  it("accepts gateway inference output that omits the Route line", () => {
    const repoRoot = path.join(__dirname, "..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-onboard-inference-route-"));
    const fakeBin = path.join(tmpDir, "bin");
    const scriptPath = path.join(tmpDir, "inference-route-check.js");
    const onboardPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "onboard.js"));
    const runnerPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "runner.js"));
    const registryPath = JSON.stringify(path.join(repoRoot, "bin", "lib", "registry.js"));

    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "openshell"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });

    const script = String.raw`
const runner = require(${runnerPath});
const registry = require(${registryPath});
const commands = [];
runner.run = (command, opts = {}) => {
  commands.push({ command, env: opts.env || null });
  return { status: 0 };
};
runner.runCapture = (command) => {
  if (command.includes("inference") && command.includes("get")) {
    return [
      "Gateway inference:",
      "",
      "  Provider: openai-api",
      "  Model: gpt-5.4",
      "  Version: 1",
      "",
      "System inference:",
      "",
      "  Not configured",
    ].join("\\n");
  }
  return "";
};
registry.updateSandbox = () => true;
process.env.OPENAI_API_KEY = "sk-secret-value";
process.env.OPENSHELL_GATEWAY = "nemoclaw";

const { setupInference } = require(${onboardPath});

(async () => {
  await setupInference("test-box", "gpt-5.4", "openai-api", "https://api.openai.com/v1", "OPENAI_API_KEY");
  console.log(JSON.stringify(commands));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
    fs.writeFileSync(scriptPath, script);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: tmpDir,
        PATH: `${fakeBin}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const commands = JSON.parse(result.stdout.trim().split("\n").pop());
    assert.equal(commands.length, 3);
  });

});
