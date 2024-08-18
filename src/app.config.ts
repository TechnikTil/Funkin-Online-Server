import config from "@colyseus/tools";
//import { monitor } from "@colyseus/monitor";
//import { playground } from "@colyseus/playground";

/**
 * Import your Room files
 */
import { GameRoom } from "./rooms/GameRoom";
import { matchMaker } from "colyseus";
import { Assets } from "./Assets";
import * as fs from 'fs';
import bodyParser from "body-parser";
import { checkSecret, genAccessToken, resetSecret, createUser, submitScore, checkLogin, submitReport, getPlayerByID, getPlayerByName, renamePlayer, pingPlayer, getIDToken, topScores, getScore, topPlayers, getScoresPlayer, authPlayer, viewReports, removeReport, removeScore, getSongComments, submitSongComment, removeSongComment, searchSongs, searchUsers } from "./network";
import cookieParser from "cookie-parser";
import TimeAgo from "javascript-time-ago";
import en from 'javascript-time-ago/locale/en'
import { Data } from "./Data";

TimeAgo.addDefaultLocale(en);
const timeAgo = new TimeAgo('en-US')

export default config({

    initializeGameServer: (gameServer) => {
        /**
         * Define your room handlers:
         */
        gameServer.define('room', GameRoom);

    },

    initializeExpress: (app) => {
        app.use(bodyParser.json({ limit: '5mb' }));
        app.use(bodyParser.urlencoded({ limit: '5mb' }));
        app.use(cookieParser());

        app.get("/rooms", async (req, res) => {
            try {
                var rooms = await matchMaker.query(/*{private: false, clients: 1}*/);
                let page = Assets.HTML_ROOMS + "<div id='filter'><div id='content'><h3><b>Available Public Rooms:</b></h3>";
                let hasPublicRoom = false;
                let playerCount = 0;

                if (rooms.length >= 1) {
                    rooms.forEach((room) => {
                        playerCount += room.clients;
                        if (!room.private && !room.locked) {
                            page += "<div class='room'> Code: " + room.roomId + "<br>Player: " + room.metadata.name + "<br>Ping: " + room.metadata.ping + "ms" + "</div>";
                            hasPublicRoom = true;
                        }
                    });
                }

                if (!hasPublicRoom) {
                    page += 'None public.<br><br><iframe src="https://www.youtube.com/embed/v4YHIYXao9I?autoplay=1" width="560" height="315" frameborder="0" allowfullscreen></iframe> <br>';
                }

                page += "<br style='clear: left'>Room Players Online: " + playerCount;
                page += "<br style='clear: left'>Network Players Online: " + Data.ONLINE_PLAYERS.length;
                page += "</div>";
                res.send(page);
            }
            catch (exc) {
                console.error(exc);
                res.sendStatus(500);
            }
        });

        app.get("/stats", async (req, res) => {
            try {
                res.send(Assets.HTML_STATS.replaceAll("$PLAYERS_ONLINE$", (await countPlayers())[0] + "").replaceAll("$HOST$", "https://" + req.hostname));
            }
            catch (exc) {
                console.error(exc);
                res.sendStatus(500);
            }
        });

        app.get("/api/front", async (req, res) => {
            try {
                const [playerCount, roomCount] = await countPlayers();
                const player = await getPlayerByID(Data.FRONT_MESSAGE_PLAYER);

                res.send({
                    online: playerCount,
                    rooms: roomCount,
                    sez: (player && Data.FRONT_MESSAGE && Data.FRONT_MESSAGE_PLAYER ? player.name + ' sez: "' + Data.FRONT_MESSAGE + '"' : null)
                });
            }
            catch (exc) {
                console.error(exc);
                res.sendStatus(500);
            }
        });

        app.get("/api/online", async (req, res) => {
            try {
                res.send('' + (await countPlayers())[0]);
            }
            catch (exc) {
                console.error(exc);
                res.sendStatus(500);
            }
        });

        if (process.env["STATS_ENABLED"] == "true") {
            app.get("/api/stats/day_players", (req, res) => {
                try {
                    res.send(Data.DAY_PLAYERS);
                }
                catch (exc) {
                    console.error(exc);
                    res.sendStatus(500);
                }
            });

            app.get("/api/stats/country_players", (req, res) => {
                try {
                    let returnMap: Map<string, number> = new Map<string, number>();
                    for (var key in Data.COUNTRY_PLAYERS) {
                        if (Data.COUNTRY_PLAYERS.hasOwnProperty(key)) {
                            returnMap.set(key, Data.COUNTRY_PLAYERS[key].length);
                        }
                    }
                    res.send(Object.fromEntries(returnMap));
                }
                catch (exc) {
                    console.error(exc);
                    res.sendStatus(500);
                }
            });
        }

        //every post request should be in a json format
        if (process.env["NETWORK_ENABLED"] == "true") {
            // will move this to react
            app.get("/network*", async (req, res) => {
                try {
                    const reqPlayer = await authPlayer(req);
                    const params = (req.params as Array<string>)[0].split("/");
                    switch (params[1]) {
                        case undefined:
                        case "":
                            res.redirect('/network/users/online');
                            break;
                        case "users":
                            if (params[2] == "online") {
                                let usersBody = '<h1>Players Online</h1><tr>';
                                for (const playerName of Data.ONLINE_PLAYERS) {
                                    usersBody += '<a href="/network/user/' + playerName + '"> ' + playerName + '</a><br>';
                                }
                                res.send(usersBody);
                            }
                            break;
                        case "user":
                            const player = await getPlayerByName(params[2]);

                            if (!player)
                                throw { error_message: "Player not found!" };

                            let trs = '';

                            const score_page = Number.parseInt(req.query.score_page as string ?? "0");

                            const scores = await getScoresPlayer(player.id, score_page);
                            scores.forEach((score:any) => {
                                const songId = (score.songId as string).split('-');
                                songId.pop();
                                trs += '<tr><td><a href="/network/song/' + score.songId + '?strum=' + score.strum + '">' + songId.join(" ") + '</a></td><td>' + score.score + '</td><td>' + score.accuracy + '</td><td>' + score.points + '</td><td>' + score.submitted + '</td></tr>';
                            });

                            let scoreStr = ' \
                            <table style="width:1000px"> \
                                <tr> \
                                <td> Song </td> \
                                <td> Score </td> \
                                <td> Accuracy </td> \
                                <td> Points </td> \
                                <td> Submitted </td> \
                                </tr>'
                                + trs +
                                '</table> \
                            ';

                            if (score_page >= 1) {
                                scoreStr += "<br> <a href='/network/user/" + player.name + "?score_page=" + (score_page - 1) + "'> <-- Previous Page </a>";
                            }
                            if (scores.length >= 15) {
                                if (score_page >= 1)
                                    scoreStr += '&nbsp';
                                else
                                    scoreStr += '<br>';
                                scoreStr += "<a href='/network/user/" + player.name + "?score_page=" + (score_page + 1) + "'> Next Page --> </a>";
                            }

                            res.send("<h2>" + player.name + "</h2> " + (player.isMod ? "Moderator" : '') + " <hr>Points: " + player.points + 
                                "<br>Online: " + (Data.VERIFIED_PLAYING_PLAYERS.includes(player.name) ? 'In a Room' : (Date.now() - player.lastActive.getTime() < 1000 * 90 ? "Now" : timeAgo.format(player.lastActive)))
                                + "<br>Joined: " + new Date(player.joined).toDateString() + '<h3>Scores:</h3><hr>' + scoreStr);
                            break;
                        case 'song':
                            const strum = Number.parseInt(req.query.strum as string ?? "2");
                            const top_page = Number.parseInt(req.query.page as string ?? "0");
                            const top = await topScores(params[2], strum, top_page);

                            let songTitle = '???';
                            let trss = '';

                            for (const score of top) {
                                const songId = params[2].split('-');
                                songId.pop();
                                songTitle = songId.join(" ");
                                const playerName = (await getPlayerByID(score.player)).name;
                                trss += '<tr><td><a href="/network/user/' + playerName + '">' + playerName + '</a></td><td>' + score.score + '</td><td>' + score.accuracy + '</td><td>' + score.points + '</td><td>' + score.submitted + '</td></tr>';
                            }

                            let topStr = ' \
                            <table style="width:1000px"> \
                                <tr> \
                                <td> Player </td> \
                                <td> Score </td> \
                                <td> Accuracy </td> \
                                <td> Points </td> \
                                <td> Submitted </td> \
                                </tr>'
                                + trss +
                                '</table> \
                            ';

                            if (top_page >= 1) {
                                topStr += "<br> <a href='/network/song/" + params[2] + "?page=" + (top_page - 1) + "'> <-- Previous Page </a>";
                            }
                            if (top.length >= 15) {
                                if (top_page >= 1)
                                    topStr += '&nbsp';
                                else
                                    topStr += '<br>';
                                topStr += "<a href='/network/song/" + params[2] + "?page=" + (top_page + 1) + "'> Next Page --> </a>";
                            }

                            const comments = await getSongComments(params[2]);
                            if (comments) {
                                topStr += "<h1>Comments</h1>";
                                for (const comment of comments) {
                                    const cumdate = new Date(comment.at);
                                    topStr += "<hr><b>" + (await getPlayerByID(comment.by)).name + '</b><br>"' + comment.content + '" at ' + cumdate.getMinutes() + ":" + cumdate.getSeconds();
                                    if (reqPlayer.id == comment.by) {
                                        topStr += "<br><a href='/network/account/remove?song_comment=" + comment.songid + "'>(REMOVE)</a>"
                                    }
                                }
                                if (comments.length <= 0) {
                                    topStr += "No comments!";
                                }
                            }

                            let strumStr = strum + "";
                            switch (strum) {
                                case 1: 
                                    strumStr += ' (Dad)';
                                    break;
                                case 2:
                                    strumStr += ' (Boyfriend)';
                                    break;
                                default:
                                    strumStr += ' (???)';
                                    break;
                            }

                            res.send('<h1>' + songTitle + "</h1><p>Strum: " + strumStr + "</p><hr>" + topStr);
                            break;
                        case 'search':
                            let resp = "<h1>Search Results for: " + req.query.q + "</h1>";
                            switch (params[2]) {
                                case 'songs':
                                    for (const song of (await searchSongs(req.query.q as string))) {
                                        resp += '<a href="/network/song/' + song.id + '"> ' + song.id + '</a><hr>';
                                    }
                                    res.send(resp);
                                    break;
                                case 'users':
                                    for (const user of (await searchUsers(req.query.q as string))) {
                                        resp += '<a href="/network/user/' + user.name + '"> ' + user.name + '</a><hr>';
                                    }
                                    res.send(resp);
                                    break;
                            }
                            break;
                        case "account":
                            if (!reqPlayer) {
                                res.send('nuh uh');
                                return;
                            }

                            switch (params[2]) {
                                case "remove":
                                    const removed = [];
                                    if (req.query.song_comment) {
                                        await removeSongComment(reqPlayer.id, req.query.song_comment as string);
                                        removed.push("song comment");
                                    }
                                    if (req.query.score) {
                                        await removeScore(req.query.score as string, reqPlayer.id);
                                        removed.push("score");
                                    }

                                    if (removed.length == 0) {
                                        res.send('none removed! <br><a href="javascript:history.back()"> go bakc </a>');
                                        return;
                                    }

                                    res.send('removed ' + removed.join(',') + '! <br><a href="javascript:history.back()"> go bakc </a>');
                                    break;
                            }

                            break;
                        case "admin":
                            if (!reqPlayer || !reqPlayer.isMod) {
                                res.send('nuh uh');
                                return;
                            }

                            switch (params[2]) {
                                case "remove":
                                    const removed = [];
                                    if (req.query.report) {
                                        await removeReport(req.query.report as string);
                                        removed.push("report");
                                    }
                                    if (req.query.score) {
                                        await removeScore(req.query.score as string);
                                        removed.push("score");
                                    }

                                    if (removed.length == 0) {
                                        res.send('none removed! <br><a href="javascript:history.back()"> go bakc </a>');
                                        return;
                                    }

                                    res.send('removed ' + removed.join(',') + '! <br><a href="javascript:history.back()"> go bakc </a>');
                                    break;
                                default:
                                    let response = '';

                                    response += '<h1>logged as ' + reqPlayer.name + "</h1>";

                                    response += '<h2> Reports: </h2><hr>';
                                    const reports = await viewReports();
                                    for (const report of reports) {
                                        const submitter = await getPlayerByID(report.by);
                                        response += 'By: ' + submitter.name;
                                        if (report.content.startsWith("Score #")) {
                                            const score = await getScore(report.content.split("Score #")[1]);
                                            if (!score) {
                                                await removeReport(report.id);
                                                response += "<br>REMOVED<hr>";
                                                continue;
                                            }
                                            const scorePlayer = await getPlayerByID(score.player);
                                            response += "<br> " + "<a href='/api/network/score/replay?id=" + score.id + "'>" + scorePlayer.name + "'s Score"
                                                + "</a> on <a href='/network/song/" + score.songId + "?strum=" + score.strum + "'>" + score.songId + "</a>"
                                                + "<br><br><a href='/network/admin/remove?report=" + report.id + "&score=" + score.id + "'>(REMOVE SCORE)</a>&nbsp;&nbsp;&nbsp;";
                                        }
                                        else {
                                            response += "<br>" + report.content + "<br><br>";
                                        }
                                        response += "<a href='/network/admin/remove?report=" + report.id + "'>(REMOVE REPORT)</a>"
                                        response += "<hr>";
                                    }
                                    response += '';

                                    res.send(response);
                                    break;
                            }
                            break;
                        default:
                            res.send("unknown page");
                            break;
                    }
                }
                catch (exc:any) {
                    console.error(exc);
                    res.status(400).send(exc?.error_message ?? "Unknown error...");
                }
            });

            /*
            -
            API STUFF
            -
            */

            //GET

            app.get("/api/network/admin/user/data", async (req, res) => {
                try {
                    const reqPlayer = await authPlayer(req);
                    if (!reqPlayer || !reqPlayer.isMod)
                        return res.sendStatus(400);
                    return res.send(await getPlayerByName(req.query.username as string));
                }
                catch (exc) {
                    res.sendStatus(500);
                }
            });

            app.get("/api/network/song/comments", async (req, res) => {
                try {
                    if (!req.query.id)
                        return res.sendStatus(400);

                    const comments = await getSongComments(req.query.id as string);
                    if (!comments)
                        return res.sendStatus(404);

                    let cmts = [];
                    for (const comment of comments) {
                        cmts.push({
                            player: (await getPlayerByID(comment.by)).name,
                            content: comment.content,
                            at: comment.at
                        });
                    }
                    res.send(cmts);
                }
                catch (exc) {
                    console.error(exc);
                    res.sendStatus(500);
                }
            });

            app.get("/api/network/score/replay", async (req, res) => {
                try {
                    if (!req.query.id)
                        return res.sendStatus(400);

                    res.send((await getScore(req.query.id as string)).replayData);
                }
                catch (exc) {
                    console.error(exc);
                    res.sendStatus(500);
                }
            });

            app.get("/api/network/top/song", async (req, res) => {
                try {
                    if (!req.query.song)
                        return res.sendStatus(400);

                    const _top = await topScores(req.query.song as string, Number.parseInt(req.query.strum as string ?? "0"), Number.parseInt(req.query.page as string ?? "0"));
                    const top:any[] = [];
                    for (const score of _top) {
                        top.push({
                            score: score.score,
                            accuracy: score.accuracy,
                            points: score.points,
                            player: (await getPlayerByID(score.player)).name,
                            submitted: score.submitted,
                            id: score.id,
                            misses: score.misses
                        });
                    }
                    res.send(top);
                }
                catch (exc) {
                    console.error(exc);
                    res.sendStatus(500);
                }
            });

            app.get("/api/network/top/players", async (req, res) => {
                try {
                    const _top = await topPlayers(Number.parseInt(req.query.page as string ?? "0"));
                    const top: any[] = [];
                    for (const score of _top) {
                        top.push({
                            player: score.name,
                            points: score.points
                        });
                    }
                    res.send(top);
                }
                catch (exc) {
                    console.error(exc);
                    res.sendStatus(500);
                }
            });

            // ping for successful authorization
            app.get("/api/network/account/me", checkLogin, async (req, res) => {
                try {
                    const [id, token] = getIDToken(req);
                    const player = await pingPlayer(id);

                    if (!Data.ONLINE_PLAYERS.includes(player.name)) {
                        Data.ONLINE_PLAYERS.push(player.name);
                    }

                    res.send({
                        name: player.name,
                        points: player.points
                    });
                }
                catch (exc) {
                    console.error(exc);
                    res.sendStatus(500);
                }
            });

            
            app.get("/api/network/account/ping", checkLogin, async (req, res) => {
                try {
                    const [id, token] = getIDToken(req);
                    const player = await pingPlayer(id);

                    if (!Data.ONLINE_PLAYERS.includes(player.name)) {
                        Data.ONLINE_PLAYERS.push(player.name);
                    }
                    
                    res.send(player.name);
                } 
                catch (exc) {
                    console.error(exc);
                    res.sendStatus(500);
                }
            });

            // saves the auth cookie in the browser
            app.get("/api/network/account/cookie", async (req, res) => {
                try {
                    if (!req.query.id || !req.query.token) return;

                    res.cookie("authid", req.query.id, {
                        expires: new Date(253402300000000)
                    });

                    res.cookie("authtoken", req.query.token, {
                        expires: new Date(253402300000000)
                    });

                    const user = await getPlayerByID(String(req.query.id));

                    res.redirect('/network/user/' + user.name);
                }
                catch (exc) {
                    console.error(exc);
                    res.sendStatus(500);
                }
            });

            // logs out the user of the website
            app.get("/api/network/account/logout", async (req, res) => {
                try {
                    res.clearCookie('authid');
                    res.clearCookie('authtoken');
                    res.sendStatus(200);
                } 
                catch (exc) {
                    console.error(exc);
                    res.sendStatus(500);
                }
            });

            //POST

            app.post("/api/network/song/comment", checkLogin, async (req, res) => {
                try {
                    const [id, _] = getIDToken(req);

                    res.json(await submitSongComment(id, req.body));
                }
                catch (exc: any) {
                    console.log(exc);
                    res.status(400).json({
                        error: exc.error_message ?? "Couldn't submit..."
                    });
                }
            });

            app.post("/api/network/sez", checkLogin, async (req, res) => {
                try {
                    if (req.body.message && req.body.message.length < 80 && !(req.body.message as string).includes("\n")) {
                        const [id, _] = getIDToken(req);
                        const player = await getPlayerByID(id);
                        
                        Data.FRONT_MESSAGE = req.body.message;
                        Data.FRONT_MESSAGE_PLAYER = player.id;
                        res.sendStatus(200);
                        return;
                    }
                    if (!req.body.message)
                        res.sendStatus(418);
                    else
                        res.sendStatus(413);
                }
                catch (exc) {
                    console.error(exc);
                    res.sendStatus(500);
                }
            });

            app.post("/api/network/account/rename", checkLogin, async (req, res) => {
                try {
                    const [id, _] = getIDToken(req);

                    if (Data.VERIFIED_PLAYING_PLAYERS.includes(id)) {
                        res.sendStatus(418);
                        return;
                    }

                    res.send((await renamePlayer(id, req.body.username)).name);
                }
                catch (exc: any) {
                    res.status(400).json({
                        error: exc.error_message ?? "Couldn't report..."
                    });
                }
            });

            // reports a replay to me!!!!
            // requires `content` json body field
            app.post("/api/network/score/report", checkLogin, async (req, res) => {
                try {
                    const [id, _] = getIDToken(req);

                    res.json(await submitReport(id, req.body));
                }
                catch (exc: any) {
                    res.status(400).json({
                        error: exc.error_message ?? "Couldn't report..."
                    });
                }
            });

            // submits user replay to the leaderboard system
            // requires replay data json data
            app.post("/api/network/score/submit", checkLogin, async (req, res) => {
                try {
                    const [id, _] = getIDToken(req);

                    res.json(await submitScore(id, req.body));
                }
                catch (exc: any) {
                    console.log(exc);
                    res.status(400).json({
                        error: exc.error_message ?? "Couldn't submit..."
                    });
                }
            });
            
            // registers the user to the database
            // requires 'username' json body field
            // todo to add user deletion from the database
            app.post("/api/network/auth/register", async (req, res) => {
                try {
                    const user = await createUser(req.body.username);
                    res.json({
                        id: user.id,
                        token: await genAccessToken(user.id),
                        secret: user.secret
                    });
                }
                catch (exc: any) {
                    res.status(400).json({
                        error: exc.error_message ?? "Couldn't register..."
                    });
                }
            });

            // resets the token and secret
            // doesnt require a body but requires to use secret instead of token in the authentication header
            app.post("/api/network/auth/reset", checkSecret, async (req, res) => {
                try {
                    const [id, _] = getIDToken(req);
                    
                    const user = await resetSecret(id);
                    res.json({
                        id: id,
                        token: await genAccessToken(user.id),
                        secret: user.secret
                    });
                }
                catch (exc: any) {
                    res.status(400).json({
                        error: exc.error_message ?? "Couldn't reset credentials..."
                    });
                }
            });
        }
        else {
            app.all("/api/network*", async (req, res) => {
                res.sendStatus(404);
            });
        }

        app.get("/", async (req, res) => {
            try {
                res.send(Assets.HTML_HOME.replaceAll("$PLAYERS_ONLINE$", (await countPlayers())[0] + ""));
            }
            catch (exc) {
                console.error(exc);
                res.sendStatus(500);
            }
        });

        /**
         * Use @colyseus/playground
         * (It is not recommended to expose this route in a production environment)
         */
        // if (process.env.NODE_ENV !== "production") {
        //     app.use("/", playground);
        // }

        /**
         * Use @colyseus/monitor
         * It is recommended to protect this route with a password
         * Read more: https://docs.colyseus.io/tools/monitor/#restrict-access-to-the-panel-using-a-password
         */
        //app.use("/colyseus", monitor());

        if (process.env["STATS_ENABLED"] == "true") {
            // refresh stats every 10 minutes
            setInterval(async function () {
                Data.DAY_PLAYERS.push([
                    (await countPlayers())[0],
                    Date.now()
                ]);

                if (Data.DAY_PLAYERS.length > 300)
                    Data.DAY_PLAYERS.shift();

                if (!fs.existsSync("database/")) {
                    fs.mkdirSync("database/");
                }

                fs.writeFileSync("database/day_players.json", JSON.stringify(Data.DAY_PLAYERS));
            }, 1000 * 60 * 10);

            // stats every minute
            setInterval(async function () {
                if (!fs.existsSync("database/")) {
                    fs.mkdirSync("database/");
                }

                fs.writeFileSync("database/country_players.json", JSON.stringify(Data.COUNTRY_PLAYERS));
            }, 1000 * 60);

            //stats every 2 minutes
            setInterval(async function () {
                let refreshPlayers:string[] = [];
                for (const pName of Data.ONLINE_PLAYERS) {
                    const player = await getPlayerByName(pName);
                    if (player && Date.now() - player.lastActive.getTime() < 1000 * 90) {
                        refreshPlayers.push(pName);
                    }
                };
                Data.ONLINE_PLAYERS = refreshPlayers;
            }, 1000 * 60 * 2);
        }
    },


    beforeListen: () => {
        /**
         * Before before gameServer.listen() is called.
         */
    }
});

/**
 * @returns [playerCount, roomFreeCount]
 */
export async function countPlayers():Promise<number[]> {
    let playerCount = 0;
    let roomCount = 0;
    var rooms = await matchMaker.query();
    if (rooms.length >= 1) {
        rooms.forEach((room) => {
            playerCount += room.clients;
            if (!room.private && !room.locked)
                roomCount++;
        });
    }
    for (const player of Data.ONLINE_PLAYERS) {
        if (!Data.VERIFIED_PLAYING_PLAYERS.includes(player)) {
            playerCount++;
        }
    }
    return [playerCount, roomCount];
}