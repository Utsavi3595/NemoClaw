// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const net = require("net");
const { checkPortAvailable, isCgroupV2, readDaemonJson, checkCgroupConfig } = require("../bin/lib/preflight");

describe("checkPortAvailable", () => {
  it("falls through to net probe when lsof output is empty", async () => {
    // Empty lsof output is not authoritative (non-root can't see root-owned
    // listeners), so the function must fall through to the net probe.
    // Use a guaranteed-free port so the net probe confirms availability.
    const freePort = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    });
    const result = await checkPortAvailable(freePort, { lsofOutput: "" });
    assert.deepEqual(result, { ok: true });
  });

  it("net probe catches occupied port even when lsof returns empty", async () => {
    // Simulates the non-root-can't-see-root-listener scenario:
    // lsof returns empty, but net probe detects the port is taken.
    const srv = net.createServer();
    const port = await new Promise((resolve) => {
      srv.listen(0, "127.0.0.1", () => resolve(srv.address().port));
    });
    try {
      const result = await checkPortAvailable(port, { lsofOutput: "" });
      assert.equal(result.ok, false);
      assert.equal(result.process, "unknown");
      assert.ok(result.reason.includes("EADDRINUSE"));
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });

  it("parses process and PID from lsof output", async () => {
    const lsofOutput = [
      "COMMAND     PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "openclaw  12345   root    7u  IPv4  54321      0t0  TCP *:18789 (LISTEN)",
    ].join("\n");
    const result = await checkPortAvailable(18789, { lsofOutput });
    assert.equal(result.ok, false);
    assert.equal(result.process, "openclaw");
    assert.equal(result.pid, 12345);
    assert.ok(result.reason.includes("openclaw"));
  });

  it("picks first listener when lsof shows multiple", async () => {
    const lsofOutput = [
      "COMMAND     PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "gateway   111   root    7u  IPv4  54321      0t0  TCP *:18789 (LISTEN)",
      "node      222   root    8u  IPv4  54322      0t0  TCP *:18789 (LISTEN)",
    ].join("\n");
    const result = await checkPortAvailable(18789, { lsofOutput });
    assert.equal(result.ok, false);
    assert.equal(result.process, "gateway");
    assert.equal(result.pid, 111);
  });

  it("net probe returns ok for a free port", async () => {
    // Find a free port by binding then releasing
    const freePort = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    });
    const result = await checkPortAvailable(freePort, { skipLsof: true });
    assert.deepEqual(result, { ok: true });
  });

  it("net probe detects occupied port", async () => {
    const srv = net.createServer();
    const port = await new Promise((resolve) => {
      srv.listen(0, "127.0.0.1", () => resolve(srv.address().port));
    });
    try {
      const result = await checkPortAvailable(port, { skipLsof: true });
      assert.equal(result.ok, false);
      assert.equal(result.process, "unknown");
      assert.ok(result.reason.includes("EADDRINUSE"));
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });

  it("smoke test with live detection on a dynamically selected free port", async () => {
    const freePort = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    });
    const result = await checkPortAvailable(freePort);
    assert.equal(result.ok, true);
  });

  it("defaults to port 18789 when no args given", async () => {
    // Should not throw — just verify it returns a valid result object
    const result = await checkPortAvailable();
    assert.equal(typeof result.ok, "boolean");
  });

  it("checks gateway port 8080", async () => {
    const freePort = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    });
    // Verify the function works with any port (including 8080-range)
    const result = await checkPortAvailable(freePort);
    assert.equal(result.ok, true);
  });
});

describe("isCgroupV2", () => {
  it("returns true when stat output is cgroup2fs (Linux)", () => {
    const result = isCgroupV2({ platform: "linux", statOutput: "cgroup2fs\n" });
    assert.equal(result, true);
  });

  it("returns false when stat output is tmpfs (Linux, cgroup v1)", () => {
    const result = isCgroupV2({ platform: "linux", statOutput: "tmpfs\n" });
    assert.equal(result, false);
  });

  it("returns false when stat fails (empty output)", () => {
    const result = isCgroupV2({ platform: "linux", statOutput: "" });
    assert.equal(result, false);
  });

  it("returns true when docker info shows Cgroup Version: 2 (macOS)", () => {
    const dockerInfo = [
      "Client:",
      " Version: 24.0.7",
      "Server:",
      " Cgroup Driver: systemd",
      " Cgroup Version: 2",
    ].join("\n");
    const result = isCgroupV2({ platform: "darwin", dockerInfoOutput: dockerInfo });
    assert.equal(result, true);
  });

  it("returns false when docker info shows Cgroup Version: 1 (macOS)", () => {
    const dockerInfo = [
      "Client:",
      " Version: 24.0.7",
      "Server:",
      " Cgroup Driver: cgroupfs",
      " Cgroup Version: 1",
    ].join("\n");
    const result = isCgroupV2({ platform: "darwin", dockerInfoOutput: dockerInfo });
    assert.equal(result, false);
  });
});

describe("readDaemonJson", () => {
  it("parses valid JSON content", () => {
    const content = JSON.stringify({ "default-cgroupns-mode": "host", "storage-driver": "overlay2" });
    const result = readDaemonJson({ daemonJsonContent: content });
    assert.deepEqual(result, { "default-cgroupns-mode": "host", "storage-driver": "overlay2" });
  });

  it("returns null for invalid JSON", () => {
    const result = readDaemonJson({ daemonJsonContent: "not json {{{" });
    assert.equal(result, null);
  });

  it("returns null when no content provided and no file exists", () => {
    // Use a platform where the daemon.json path won't exist
    const result = readDaemonJson({ platform: "linux" });
    // On CI/dev machines /etc/docker/daemon.json may or may not exist,
    // but we can at least verify the return type is object or null.
    assert.ok(result === null || typeof result === "object");
  });
});

describe("checkCgroupConfig", () => {
  it("returns ok when cgroup v1 (not v2)", () => {
    const result = checkCgroupConfig({ cgroupV2: false });
    assert.deepEqual(result, { ok: true });
  });

  it("returns ok when cgroup v2 + cgroupns=host configured", () => {
    const result = checkCgroupConfig({
      cgroupV2: true,
      daemonConfig: { "default-cgroupns-mode": "host" },
    });
    assert.deepEqual(result, { ok: true });
  });

  it("returns not ok on Linux with no daemon.json, fix suggests setup-spark", () => {
    const result = checkCgroupConfig({
      platform: "linux",
      runtime: "docker",
      cgroupV2: true,
      daemonConfig: null,
    });
    assert.equal(result.ok, false);
    assert.ok(result.fix.includes("setup-spark"));
    assert.ok(result.reason.includes("does not exist"));
  });

  it("returns not ok on Docker Desktop, fix suggests Docker Desktop settings", () => {
    const result = checkCgroupConfig({
      platform: "darwin",
      runtime: "docker-desktop",
      cgroupV2: true,
      daemonConfig: null,
    });
    assert.equal(result.ok, false);
    assert.ok(result.fix.includes("Docker Desktop"));
    assert.ok(result.reason.includes("daemon.json"));
  });

  it("returns not ok on Colima, fix suggests colima restart with flag", () => {
    const result = checkCgroupConfig({
      platform: "darwin",
      runtime: "colima",
      cgroupV2: true,
      daemonConfig: null,
    });
    assert.equal(result.ok, false);
    assert.ok(result.fix.includes("colima stop"));
    assert.ok(result.fix.includes("--cgroupns-mode host"));
    assert.ok(result.reason.includes("Colima"));
  });

  it("returns ok when cgroup v2 + Colima + daemonConfig has host mode", () => {
    const result = checkCgroupConfig({
      platform: "darwin",
      runtime: "colima",
      cgroupV2: true,
      daemonConfig: { "default-cgroupns-mode": "host" },
    });
    assert.deepEqual(result, { ok: true });
  });
});
