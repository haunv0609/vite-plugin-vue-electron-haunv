const { spawn } = require("child_process")
const http = require("http")
const getPort = require("get-port").default
const chokidar = require("chokidar")
const kill = require("tree-kill")
const electron = require("electron")

let electronProcess
let port
let viteProcess

function waitForServer(url, { interval = 500, timeout = 60000 } = {}) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeout

        function poll() {
            http.get(url, (res) => {
                res.resume()
                resolve()
            }).on("error", () => {
                if (Date.now() >= deadline) {
                    reject(new Error(`Timeout waiting for ${url}`))
                } else {
                    setTimeout(poll, interval)
                }
            })
        }

        setTimeout(poll, 1000)
    })
}

async function run() {
    port = await getPort({ port: [5173, 5174, 5175, 8080, 8081] })

    // Start Vite dev server
    viteProcess = spawn("npx", ["vite", "--port", port, "--strictPort"], {
        stdio: "inherit",
        shell: true
    })

    // Wait for Vite to be ready
    console.log(`Waiting for Vite dev server on http://localhost:${port} ...`)
    await waitForServer(`http://localhost:${port}`)
    console.log("Vite ready — starting Electron...")

    startElectron()

    // Hot reload when files inside electron/ change
    chokidar
        .watch(["electron"], { ignoreInitial: true })
        .on("all", (event, filePath) => {
            console.log(`${filePath} changed — restarting Electron...`)
            restartElectron()
        })
}

function startElectron() {
    electronProcess = spawn(electron, ["."], {
        stdio: "inherit",
        env: {
            ...process.env,
            NODE_ENV: "development",
            DEV_SERVER_URL: `http://localhost:${port}`
        }
    })

    electronProcess.on("exit", (code) => {
        console.log("Electron closed — stopping dev server...")
        if (viteProcess && viteProcess.pid) {
            kill(viteProcess.pid, () => {
                process.exit(code ?? 0)
            })
        } else {
            process.exit(code ?? 0)
        }
    })
}

function restartElectron() {
    if (!electronProcess) return
    kill(electronProcess.pid, () => startElectron())
}

run().catch((err) => {
    console.error("dev-runner error:", err)
    process.exit(1)
})