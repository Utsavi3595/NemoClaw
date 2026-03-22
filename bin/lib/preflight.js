// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Preflight checks for NemoClaw onboarding.

const net = require("net");
const { runCapture } = require("./runner");

/**
 * Check whether a TCP port is available for listening.
 *
 * Detection chain:
 *   1. lsof (primary) — identifies the blocking process name + PID
 *   2. Node.js net probe (fallback) — cross-platform, detects EADDRINUSE
 *
 * opts.lsofOutput — inject fake lsof output for testing (skips shell)
 * opts.skipLsof   — force the net-probe fallback path
 *
 * Returns:
 *   { ok: true }
 *   { ok: false, process: string, pid: number|null, reason: string }
 */
async function checkPortAvailable(port, opts) {
  const p = port || 18789;
  const o = opts || {};

  // ── lsof path ──────────────────────────────────────────────────
  if (!o.skipLsof) {
    let lsofOut;
    if (typeof o.lsofOutput === "string") {
      lsofOut = o.lsofOutput;
    } else {
      const hasLsof = runCapture("command -v lsof", { ignoreError: true });
      if (hasLsof) {
        lsofOut = runCapture(
          `lsof -i :${p} -sTCP:LISTEN -P -n 2>/dev/null`,
          { ignoreError: true }
        );
      }
    }

    if (typeof lsofOut === "string") {
      const lines = lsofOut.split("\n").filter((l) => l.trim());
      // Skip the header line (starts with COMMAND)
      const dataLines = lines.filter((l) => !l.startsWith("COMMAND"));
      if (dataLines.length > 0) {
        // Parse first data line: COMMAND PID USER ...
        const parts = dataLines[0].split(/\s+/);
        const proc = parts[0] || "unknown";
        const pid = parseInt(parts[1], 10) || null;
        return {
          ok: false,
          process: proc,
          pid,
          reason: `lsof reports ${proc} (PID ${pid}) listening on port ${p}`,
        };
      }
      // Empty lsof output is not authoritative — non-root users cannot
      // see listeners owned by root (e.g., docker-proxy, leftover gateway).
      // Fall through to the net probe which uses bind() at the kernel level.
    }
  }

  // ── net probe fallback ─────────────────────────────────────────
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve({
          ok: false,
          process: "unknown",
          pid: null,
          reason: `port ${p} is in use (EADDRINUSE)`,
        });
      } else {
        // Unexpected error — treat port as unavailable
        resolve({
          ok: false,
          process: "unknown",
          pid: null,
          reason: `port probe failed: ${err.message}`,
        });
      }
    });
    srv.listen(p, "127.0.0.1", () => {
      srv.close(() => resolve({ ok: true }));
    });
  });
}

/**
 * Detect whether the Docker host uses cgroup v2.
 *
 * On Linux: runs `stat -fc %T /sys/fs/cgroup` (returns "cgroup2fs" for v2).
 * On macOS: Docker runs in a VM, so check `docker info` for "Cgroup Version: 2".
 *
 * opts.statOutput       — inject stat output for testing (Linux path)
 * opts.dockerInfoOutput — inject docker info output for testing (macOS path)
 * opts.platform         — override process.platform for testing
 */
function isCgroupV2(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;

  if (platform === "linux") {
    let statOut;
    if (typeof o.statOutput === "string") {
      statOut = o.statOutput;
    } else {
      statOut = runCapture("stat -fc %T /sys/fs/cgroup 2>/dev/null", { ignoreError: true });
    }
    return typeof statOut === "string" && statOut.trim() === "cgroup2fs";
  }

  // macOS / other — check Docker VM's cgroup version via docker info
  let dockerInfo;
  if (typeof o.dockerInfoOutput === "string") {
    dockerInfo = o.dockerInfoOutput;
  } else {
    dockerInfo = runCapture("docker info 2>/dev/null", { ignoreError: true });
  }
  if (typeof dockerInfo === "string") {
    const match = dockerInfo.match(/Cgroup Version:\s*(\d+)/i);
    return match && match[1] === "2";
  }
  return false;
}

/**
 * Read Docker daemon configuration.
 *
 * On Linux: /etc/docker/daemon.json
 * On macOS Docker Desktop: ~/.docker/daemon.json
 *
 * opts.daemonJsonContent — inject file content for testing
 * opts.platform          — override process.platform
 */
function readDaemonJson(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;

  if (typeof o.daemonJsonContent === "string") {
    try { return JSON.parse(o.daemonJsonContent); } catch { return null; }
  }

  const fs = require("fs");
  const paths = [];
  if (platform === "linux") {
    paths.push("/etc/docker/daemon.json");
  } else if (platform === "darwin") {
    const home = process.env.HOME || "/tmp";
    paths.push(require("path").join(home, ".docker", "daemon.json"));
  }

  for (const p of paths) {
    try {
      const content = fs.readFileSync(p, "utf-8");
      return JSON.parse(content);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Check whether Docker is configured for cgroup v2 compatibility.
 *
 * Returns { ok: true } when cgroup v1 or properly configured.
 * Returns { ok: false, runtime, reason, fix } with platform-specific guidance.
 *
 * opts.platform          — override process.platform
 * opts.runtime           — container runtime name (from inferContainerRuntime)
 * opts.cgroupV2          — override isCgroupV2 result for testing
 * opts.daemonConfig      — override readDaemonJson result for testing
 */
function checkCgroupConfig(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const runtime = o.runtime || "unknown";

  const isV2 = typeof o.cgroupV2 === "boolean" ? o.cgroupV2 : isCgroupV2({ platform, statOutput: o.statOutput, dockerInfoOutput: o.dockerInfoOutput });
  if (!isV2) {
    return { ok: true };
  }

  const config = o.daemonConfig !== undefined ? o.daemonConfig : readDaemonJson({ platform, daemonJsonContent: o.daemonJsonContent });
  const cgroupMode = config && config["default-cgroupns-mode"];
  if (cgroupMode === "host") {
    return { ok: true };
  }

  // cgroup v2 detected but not configured — provide platform-specific fix
  let fix, reason;

  if (runtime === "colima") {
    fix = "colima stop && colima start --cgroupns-mode host";
    reason = "Colima is running with cgroup v2 but cgroupns-mode is not set to host";
  } else if (runtime === "docker-desktop" || platform === "darwin") {
    fix = 'Open Docker Desktop → Settings → Docker Engine → add "default-cgroupns-mode": "host" → Apply & restart';
    reason = platform === "darwin"
      ? "Docker Desktop VM uses cgroup v2 but daemon.json does not set default-cgroupns-mode to host"
      : "Docker Desktop uses cgroup v2 but daemon.json does not set default-cgroupns-mode to host";
  } else {
    // Linux with plain Docker
    fix = "sudo nemoclaw setup-spark";
    if (config === null) {
      reason = "/etc/docker/daemon.json does not exist";
    } else if (!config["default-cgroupns-mode"]) {
      reason = '/etc/docker/daemon.json exists but "default-cgroupns-mode" is not set to "host"';
    } else {
      reason = `/etc/docker/daemon.json has "default-cgroupns-mode": "${config["default-cgroupns-mode"]}" (expected "host")`;
    }
  }

  return { ok: false, runtime, reason, fix };
}

module.exports = { checkPortAvailable, isCgroupV2, readDaemonJson, checkCgroupConfig };
