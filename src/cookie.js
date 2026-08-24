import { execFileSync, execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const COOKIE_NAME = ".ROBLOSECURITY";

/** @typedef {{ name: string, value: string }} Cookie */

/**
 * Gets the Roblox auth cookie from an authenticated Roblox Studio installation or an environment variable.
 * Ported from [rbx_cookie (Mantle)](https://github.com/blake-mealey/mantle/tree/main/mantle/rbx_cookie/src).
 *
 * @returns {string | undefined}
 */
export function getRoblosecurity() {
  return fromEnvironment() || fromRobloxStudio() || fromRobloxStudioLegacy();
}

/** @returns {string | undefined} */
function fromEnvironment() {
  return process.env.ROBLOSECURITY;
}

/** @returns {string | undefined} */
function fromRobloxStudio() {
  const platform = os.platform();
  if (platform === "win32") {
    return fromRobloxStudioWindows();
  } else if (platform === "darwin") {
    return fromRobloxStudioMac();
  } else if (platform === "linux" && isWsl()) {
    return fromRobloxStudioWindows("powershell.exe");
  }
  return undefined;
}

/** @returns {string | undefined} */
function fromRobloxStudioWindows(powershellCommand = "powershell") {
  try {
    // First try the userid postfixed cookie
    const userId = getWinCred(
      "https://www.roblox.com:RobloxStudioAuthuserid",
      powershellCommand,
    );
    if (userId) {
      const cookie = getWinCred(
        `https://www.roblox.com:RobloxStudioAuth${COOKIE_NAME}${userId}`,
        powershellCommand,
      );
      if (cookie) return cookie;
    }

    // Fallback to the old cookie
    return getWinCred(
      `https://www.roblox.com:RobloxStudioAuth${COOKIE_NAME}`,
      powershellCommand,
    );
  } catch {
    return undefined;
  }
}

/** @returns {boolean} */
function isWsl() {
  return Boolean(
    process.env.WSL_INTEROP ||
    process.env.WSL_DISTRO_NAME ||
    os.release().toLowerCase().includes("microsoft"),
  );
}

/**
 * @param {string} target
 * @param {string} powershellCommand
 * @returns {string | undefined}
 */
function getWinCred(target, powershellCommand) {
  try {
    // Encode the target as base64 so we can safely embed it in a literal
    // PS string — no quote escaping, no interpolation surprises, and the
    // whole script still goes through -EncodedCommand for safety.
    const targetB64 = Buffer.from(target, "utf8").toString("base64");
    // CREDENTIALW layout on x64 (matches wincred.cpp native version):
    //   0x20 = CredentialBlobSize (uint32), 0x28 = CredentialBlob (pointer)
    // We read those two fields directly to avoid PtrToStructure, which
    // fails because FILETIME isn't blittable in PowerShell.
    const psScript = `
$target = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${targetB64}'))
$win32Type = $null
try { $win32Type = [Win32] -as [type] } catch {}
if (-not $win32Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("Advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credentialPtr);
    [DllImport("Advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr credentialPtr);
}
'@
}
$ptr = [IntPtr]::Zero
if ([Win32]::CredReadW($target, 1, 0, [ref]$ptr)) {
    $blobSize = [System.Runtime.InteropServices.Marshal]::ReadInt32($ptr, 0x20)
    $blobPtr  = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($ptr, 0x28)
    if ($blobSize -gt 0 -and $blobPtr -ne [IntPtr]::Zero) {
        $bytes = New-Object byte[] $blobSize
        [System.Runtime.InteropServices.Marshal]::Copy($blobPtr, $bytes, 0, $blobSize)
        [System.Text.Encoding]::UTF8.GetString($bytes)
    }
    [Win32]::CredFree($ptr)
}
`.trim();
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");
    const output = execFileSync(
      powershellCommand,
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** @returns {string | undefined} */
function fromRobloxStudioMac() {
  try {
    const filePath = path.join(
      os.homedir(),
      "Library/HTTPStorages/com.Roblox.RobloxStudio.binarycookies",
    );
    if (!fs.existsSync(filePath)) return undefined;

    const data = fs.readFileSync(filePath);
    return parseBinaryCookies(data);
  } catch {
    return undefined;
  }
}

/**
 * @param {Buffer} data
 * @returns {string | undefined}
 */
function parseBinaryCookies(data) {
  // Magic: COOK
  if (data.length < 8 || data.slice(0, 4).toString() !== "COOK")
    return undefined;

  const pageCount = data.readUInt32BE(4);
  /** @type {number[]} */
  const pageSizes = [];
  for (let i = 0; i < pageCount; i++) {
    pageSizes.push(data.readUInt32BE(8 + i * 4));
  }

  let offset = 8 + pageCount * 4;
  /** @type {Cookie[]} */
  const cookies = [];
  for (const pageSize of pageSizes) {
    if (offset + pageSize > data.length) break;
    const pageData = data.slice(offset, offset + pageSize);
    const pageCookies = parsePage(pageData);
    if (pageCookies) cookies.push(...pageCookies);
    offset += pageSize;
  }

  // Try finding by name directly
  const directMatch = cookies.find((c) => c.name === COOKIE_NAME);
  if (directMatch) return directMatch.value;

  // Try finding by userid logic
  const userIdCookie = cookies.find(
    (c) => c.name === "/RobloxStudioAuth/userid",
  );
  if (userIdCookie) {
    const targetName = `/RobloxStudioAuth/${COOKIE_NAME}${userIdCookie.value}`;
    const targetCookie = cookies.find((c) => c.name === targetName);
    if (targetCookie) return targetCookie.value;
  }

  return undefined;
}

/**
 * @param {Buffer} data
 * @returns {Cookie[] | undefined}
 */
function parsePage(data) {
  if (data.length < 8 || data.readUInt32BE(0) !== 0x00000100) return undefined;

  const cookieCount = data.readUInt32LE(4);
  /** @type {number[]} */
  const cookieOffsets = [];
  for (let i = 0; i < cookieCount; i++) {
    cookieOffsets.push(data.readUInt32LE(8 + i * 4));
  }

  /** @type {Cookie[]} */
  const cookies = [];
  for (const cookieOffset of cookieOffsets) {
    if (cookieOffset >= data.length) continue;
    const cookie = parseCookie(data.slice(cookieOffset));
    if (cookie) cookies.push(cookie);
  }

  return cookies;
}

/**
 * @param {Buffer} data
 * @returns {Cookie | undefined}
 */
function parseCookie(data) {
  if (data.length < 0x30) return undefined;

  const nameOff = data.readUInt32LE(0x14);
  const valueOff = data.readUInt32LE(0x1c);

  if (nameOff >= data.length || valueOff >= data.length) return undefined;

  const name = readCString(data.slice(nameOff));
  const value = readCString(data.slice(valueOff));

  return { name, value };
}

/**
 * @param {Buffer} data
 * @returns {string}
 */
function readCString(data) {
  const end = data.indexOf(0);
  if (end === -1) return data.toString("utf8");
  return data.slice(0, end).toString("utf8");
}

/** @returns {string | undefined} */
function fromRobloxStudioLegacy() {
  const platform = os.platform();
  if (platform === "win32") {
    try {
      const output = execSync(
        `reg query "HKEY_CURRENT_USER\\SOFTWARE\\Roblox\\RobloxStudioBrowser\\roblox.com" /v "${COOKIE_NAME}"`,
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        },
      );
      const match = output.match(/\.ROBLOSECURITY\s+REG_SZ\s+(.*)/);
      if (match) {
        return parseRobloxStudioCookie(match[1].trim());
      }
    } catch {}
  } else if (platform === "darwin") {
    try {
      const plistPath = path.join(
        os.homedir(),
        "Library/Preferences/com.roblox.RobloxStudioBrowser.plist",
      );
      if (fs.existsSync(plistPath)) {
        const output = execSync(`plutil -convert json -o - "${plistPath}"`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const json = JSON.parse(output);
        for (const key in json) {
          if (key.endsWith(COOKIE_NAME)) {
            return parseRobloxStudioCookie(json[key]);
          }
        }
      }
    } catch {}
  }
  return undefined;
}

/**
 * @param {string} value
 * @returns {string | undefined}
 */
function parseRobloxStudioCookie(value) {
  for (const item of value.split(",")) {
    const parts = item.split("::");
    if (parts[0] === "COOK" && parts[1]) {
      let cookie = parts[1];
      if (cookie.startsWith("<") && cookie.endsWith(">")) {
        return cookie.substring(1, cookie.length - 1);
      }
      return cookie;
    }
  }
  return undefined;
}
