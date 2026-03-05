const express = require("express")
const app = express()

app.use(express.json())

let lastData = null

app.post("/update", (req, res) => {
    lastData = req.body
    console.log("Received:", lastData)
    res.send("OK")
})

app.get("/", (req, res) => {
    res.send(`
        <h1>Solar Panel Monitor</h1>
        <pre>${JSON.stringify(lastData, null, 2)}</pre>
    `)
})

app.listen(3000, "0.0.0.0", () => {
    console.log("Server running on port 3000")
})