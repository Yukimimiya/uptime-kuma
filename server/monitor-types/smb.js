const { MonitorType } = require("./monitor-type");
const { UP } = require("../../src/util");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

class SMBMonitorType extends MonitorType {
    name = "smb";

    async check(monitor, heartbeat) {
        const host = String(monitor.hostname || "").trim();
        const share = String(monitor.smbShare || "").trim();
        const directory = String(monitor.smbPath || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        const port = Number(monitor.port || 445);
        if (!host || /[\\/\r\n\0]/.test(host) || host.startsWith("-") ||
            !share || /[\\/\r\n\0]/.test(share) || share.startsWith("-") ||
            !Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error("Invalid SMB host, share or port");
        }
        if (directory.split("/").some((part) => part === ".." || part === ".") || /[\r\n\0]/.test(directory)) {
            throw new Error("Invalid SMB directory");
        }
        const username = String(monitor.smbUsername || "");
        const password = String(monitor.smbPassword || "");
        const domain = String(monitor.smbDomain || "WORKGROUP");
        if (!username || [username, password, domain].some((s) => /[\r\n\0]/.test(s))) {
            throw new Error("Invalid SMB credentials");
        }
        const timeoutMs = Math.max(1000, Math.min(Number(monitor.timeout || 10) * 1000, 120000));
        const started = Date.now();
        let tempDir;
        try {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "uptime-kuma-smb-"));
            await fs.chmod(tempDir, 0o700);
            const authFile = path.join(tempDir, "credentials");
            await fs.writeFile(authFile, `username = ${username}\npassword = ${password}\ndomain = ${domain}\n`, { mode: 0o600, flag: "wx" });
            const args = [`//${host}/${share}`, "--authentication-file", authFile, "--port", String(port), "--max-protocol", "SMB3"];
            if (directory) args.push("--directory", directory);
            args.push("--command", "ls");
            await new Promise((resolve, reject) => {
                const child = spawn("smbclient", args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } });
                let stderr = "";
                let stdout = "";
                let settled = false;
                let timedOut = false;
                const timer = setTimeout(() => {
                    timedOut = true;
                    child.kill("SIGKILL");
                }, timeoutMs);
                const finish = (err) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (err) reject(err);
                    else resolve();
                };
                child.stdout.on("data", (buf) => { stdout = (stdout + buf.toString()).slice(-8192); });
                child.stderr.on("data", (buf) => { stderr = (stderr + buf.toString()).slice(-8192); });
                child.on("error", (err) => finish(new Error(err.code === "ENOENT" ? "smbclient is not installed" : "Failed to launch smbclient")));
                child.on("close", (code) => {
                    if (timedOut) return finish(new Error("SMB directory listing failed (timeout)"));
                    if (code !== 0) return finish(new Error("SMB directory listing failed (connection/auth/access error)"));
                    // smbclient may report a command failure while exiting with status 0.
                    if (/NT_STATUS_[A-Z0-9_]+|Error opening remote directory|NT_STATUS/i.test(stdout + stderr)) {
                        return finish(new Error("SMB directory listing failed (remote error)"));
                    }
                    finish();
                });
            });
            heartbeat.status = UP;
            heartbeat.ping = Date.now() - started;
            heartbeat.msg = "SMB directory listing successful";
        } finally {
            if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
        }
    }
}

module.exports = { SMBMonitorType };
