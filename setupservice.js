if (process.platform !== "linux") {
    throw "only linux services.";
}

cp.execSync("npm i");

const fs = require('fs');
const cp = require('child_process');

let service = "" +
"[Unit]\n" +
"Description = Funkin Online server service\n" +
"After = network.target\n" +
"StartLimitIntervalSec = 0\n" +
"[Service]\n" +
"Type = simple\n" +
"Restart = always\n" +
"RestartSec = 1\n" +
"WorkingDirectory = " + __dirname + "\n" +
"ExecStart = npm start\n" +
"[Install]\n" +
"WantedBy = multi - user.target"
;

fs.writeFileSync('/etc/systemd/system/funkin-online.service', service, function (err) {
    if (err) throw err;
    console.log('Service created!');
    try {
        cp.execSync("systemctl stop funkin-online.service");
    } catch (exc) {}
    cp.execSync("systemctl start funkin-online.service");
});