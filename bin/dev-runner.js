const { spawn } = require("child_process")
const http = require("http")
const getPort = require("get-port").default
const chokidar = require("chokidar")
const kill = require("tree-kill")
const electron = require("electron")

let electronProcess
let port

function waitForServer(url, { interval = 250, timeout = 30000 } = {}) {
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

        poll()
    })
}

async function run() {
    port = await getPort({
        port: [8080, 8081, 8082]
    })

    spawn(
        "npm",
        ["run", "serve", "--", "--port", port],
        {
            stdio: "inherit",
            shell: true
        }
    )

    await waitForServer(`http://localhost:${port}`)

    startElectron()

    chokidar
        .watch(["electron"], { ignoreInitial: true })
        .on("all", () => {
            restartElectron()
        })
}

function startElectron() {
    electronProcess = spawn(
        electron,
        ["."],
        {
            stdio: "inherit",
            env: {
                ...process.env,
                DEV_SERVER_URL: `http://localhost:${port}`
            }
        }
    )

    setupExitListener()
}

function restartElectron() {
    if (electronProcess) {
        kill(electronProcess.pid)
        startElectron()
    }
}

function setupExitListener() {
    if (!electronProcess) return

    electronProcess.on("exit", () => {
        console.log("🛑 Electron closed → stopping dev server...")
        process.exit()
    })
}

run()