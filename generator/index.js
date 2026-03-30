const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const cache = {}

function getLatestVersion(pkg) {
    if (cache[pkg]) return cache[pkg]

    try {
        const v = execSync(`npm view ${pkg} version`, {
            stdio: ["pipe", "pipe", "ignore"]
        })
            .toString()
            .trim()

        cache[pkg] = v
        return v
    } catch (e) {
        console.warn(`Cannot fetch ${pkg}, fallback to latest`)
        return "latest"
    }
}

// ─── Project root ──────────────────────────────────────────────────────────
// INIT_CWD = the directory where the user ran npm/npx
const projectRoot = process.env.INIT_CWD || process.cwd()
const pkgPath = path.join(projectRoot, "package.json")

// ─── Colors ────────────────────────────────────────────────────────────────
const G = "\x1b[32m", Y = "\x1b[33m", C = "\x1b[36m", R = "\x1b[0m", B = "\x1b[1m"
const ok   = (msg) => console.log(`${G}✔${R}  ${msg}`)
const info = (msg) => console.log(`${C}ℹ${R}  ${msg}`)
const warn = (msg) => console.log(`${Y}⚠${R}  ${msg}`)
const step = (msg) => console.log(`\n${B}${C}❯ ${msg}${R}`)

function run() {
    console.log(`\n${B}${C}◆ vite-plugin-vue-electron-haunv — setup${R}`)
    console.log(`${C}  Project: ${projectRoot}${R}`)

    // ─── Guard ─────────────────────────────────────────────────────────────
    if (!fs.existsSync(pkgPath)) {
        console.error("✖  package.json not found. Run this inside your Vite project root.")
        process.exit(1)
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))

    const hasVite = pkg.devDependencies?.vite || pkg.dependencies?.vite
    if (!hasVite) {
        warn("Vite not detected in dependencies. This plugin is designed for Vite + Vue 3 projects.")
    }

    // ─── Step 1: patch package.json ────────────────────────────────────────
    step("Updating package.json")

    console.log("Fetching latest versions from npm registry...")

    const electronVersion = getLatestVersion("electron")
    const builderVersion  = getLatestVersion("electron-builder")

    console.log("Using versions:")
    console.log("   electron:", electronVersion)
    console.log("   electron-builder:", builderVersion)

    let pkgChanged = false

    if (pkg.main !== "electron/main.cjs") {
        pkg.main = "electron/main.cjs"
        pkgChanged = true
    }

    pkg.scripts = pkg.scripts || {}
    if (!pkg.scripts["electron:dev"]) {
        pkg.scripts["electron:dev"] = "node node_modules/vite-plugin-vue-electron-haunv/bin/dev-runner.js"
        pkgChanged = true
    }
    if (!pkg.scripts["electron:build"]) {
        pkg.scripts["electron:build"] = "vite build && electron-builder --config electron-builder.json"
        pkgChanged = true
    }

    pkg.devDependencies = pkg.devDependencies || {}
    if (!pkg.devDependencies["electron"]) {
        pkg.devDependencies["electron"] = `^${electronVersion}`
        pkgChanged = true
    }
    if (!pkg.devDependencies["electron-builder"]) {
        pkg.devDependencies["electron-builder"] = `^${builderVersion}`
        pkgChanged = true
    }
    if (!pkg.devDependencies["@tomjs/electron-devtools-installer"]) {
        pkg.devDependencies["@tomjs/electron-devtools-installer"] = "^4.0.1"
        pkgChanged = true
    }

    if (pkgChanged) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8")
        ok("package.json updated")
    } else {
        info("package.json already up to date")
    }

    // ─── Step 2: copy template files ───────────────────────────────────────
    step("Creating electron files")

    const templateDir = path.join(__dirname, "template/electron")
    const electronDir = path.join(projectRoot, "electron")

    if (!fs.existsSync(electronDir)) fs.mkdirSync(electronDir)

    function copyIfMissing(filename) {
        const dest = path.join(electronDir, filename)
        if (fs.existsSync(dest)) {
            info(`electron/${filename} already exists, skipped`)
            return
        }
        fs.copyFileSync(path.join(templateDir, filename), dest)
        ok(`electron/${filename} created`)
    }

    copyIfMissing("main.cjs")
    copyIfMissing("preload.js")

    // ─── Step 3: copy electron-builder.json ────────────────────────────────
    step("Creating electron-builder.json")

    const builderDest = path.join(projectRoot, "electron-builder.json")
    if (fs.existsSync(builderDest)) {
        info("electron-builder.json already exists, skipped")
    } else {
        const builderSrc = path.join(templateDir, "electron-builder.json")
        const builderConfig = JSON.parse(fs.readFileSync(builderSrc, "utf-8"))

        // Personalize from project package.json
        const appName = pkg.name || "MyApp"
        builderConfig.productName = appName
        builderConfig.appId = `com.haunv.${appName.replace(/[^a-z0-9]/gi, "").toLowerCase()}`

        fs.writeFileSync(builderDest, JSON.stringify(builderConfig, null, 4) + "\n", "utf-8")
        ok("electron-builder.json created")
    }

    // ─── Step 4: patch vite.config ─────────────────────────────────────────
    step("Patching vite.config")

    const configCandidates = ["vite.config.js", "vite.config.ts"]
    let viteConfigPath = null

    for (const name of configCandidates) {
        const p = path.join(projectRoot, name)
        if (fs.existsSync(p)) {
            viteConfigPath = p
            break
        }
    }

    if (!viteConfigPath) {
        warn("vite.config not found, skipped")
    } else {
        let content = fs.readFileSync(viteConfigPath, "utf-8")
        let changed = false

        // ─── Inject plugin ─────────────────────────────
        if (!content.includes("vite-plugin-vue-electron-haunv")) {
            content = `import electronPlugin from 'vite-plugin-vue-electron-haunv'\n` + content

            if (content.includes("plugins:")) {
                content = content.replace(
                    /plugins\s*:\s*\[/,
                    "plugins: [\n    electronPlugin(),"
                )
                ok("vite.config patched — electronPlugin() added")
                changed = true
            } else {
                warn("Could not find plugins[] in vite.config. Add electronPlugin() manually.")
            }
        } else {
            info("electron plugin already exists")
        }

        // ─── Inject base: './' ─────────────────────────
        if (!content.includes("base:")) {
            if (content.includes("defineConfig")) {
                content = content.replace(
                    /defineConfig\s*\(\s*{/,
                    `defineConfig({
    base: './',`
                )
                ok("vite.config patched — base: './' added")
                changed = true
            } else if (content.includes("export default {")) {
                content = content.replace(
                    /export default\s*{/,
                    `export default {
    base: './',`
                )
                ok("vite.config patched — base: './' added")
                changed = true
            } else {
                warn("Could not auto inject base. Please add: base: './'")
            }
        } else {
            info("base already exists")
        }

        if (changed) {
            fs.writeFileSync(viteConfigPath, content, "utf-8")
        } else {
            info("vite.config already up to date")
        }
    }

    // ─── Step 5: update .gitignore ─────────────────────────────────────────
    const gitignorePath = path.join(projectRoot, ".gitignore")
    if (fs.existsSync(gitignorePath)) {
        let gi = fs.readFileSync(gitignorePath, "utf-8")
        let giChanged = false
        for (const entry of ["dist_electron/", "dist/"]) {
            if (!gi.includes(entry)) { gi += `\n${entry}`; giChanged = true }
        }
        if (giChanged) {
            fs.writeFileSync(gitignorePath, gi, "utf-8")
            ok(".gitignore updated")
        }
    }

    // ─── Step 6: npm install ────────────────────────────────────────────────
    step("Installing dependencies")

    try {
        execSync("npm install", {
            stdio: "inherit",
            cwd: projectRoot
        })
        ok("All dependencies installed")
    } catch {
        warn("npm install failed. Run it manually.")
    }

    // ─── Done ───────────────────────────────────────────────────────────────
    console.log(`\n${G}${B}✔ Setup complete!${R}\n`)
    console.log(`  ${C}npm run electron:dev${R}    → start dev mode`)
    console.log(`  ${C}npm run electron:build${R}  → build for production\n`)
}

run()
