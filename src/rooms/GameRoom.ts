import { Room, Client } from "@colyseus/core";
import { RoomState } from "./schema/RoomState";
import { Player } from "./schema/Player";
import { IncomingMessage } from "http";
import { ServerError } from "colyseus";
import { MapSchema } from "@colyseus/schema";
import { getPlayerByID } from "../network";
import jwt from "jsonwebtoken";
import { filterUsername } from "../util";
import { Data } from "../Data";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export class GameRoom extends Room<RoomState> {
  maxClients = 2;
  LOBBY_CHANNEL = "$lobbiesChannel"
  IPS_CHANNEL = "$IPSChannel"
  chartHash:string = null;
  clientsIP: Map<Client, string> = new Map<Client, string>();
  clientsID: Map<Client, string> = new Map<Client, string>();
  lastPingTime:number = null;

  async onCreate (options: any) {
    this.roomId = await this.generateRoomId();
    this.setPrivate(!options.public);
    this.setState(new RoomState());
    this.autoDispose = true;

    var daGameplaySettings = options.gameplaySettings;
    if (daGameplaySettings) {
      for (const key in daGameplaySettings) {
        const value = daGameplaySettings[key].toString();
        if (key == "instakill" || key == "practice" || key == "opponentplay") {
          continue;
        }
        this.state.gameplaySettings.set(key, value);
      }
    }

    this.setMetadata({name: options.name});

    this.onMessage("toggleParty", (client, message) => {
      if (this.isOwner(client)) {
        this.state.partyMode = !this.state.partyMode;
      }

      if (this.state.partyMode) {
        this.maxClients = 8;
      }
      else {
        this.maxClients = 2;

        let i = this.clients.length - 1;
        while (this.clients.length > 2) {
          if (!this.isOwner(this.clients.at(i))) {
            this.clients.at(i).leave(4100);
          }
          i--;
          if (i < 0) {
            i = this.clients.length - 1;
          }
        }
      }
    });

    this.onMessage("togglePrivate", (client, message) => {
      if (this.isOwner(client)) {
        this.state.isPrivate = !this.state.isPrivate;
        this.setPrivate(this.state.isPrivate);
      }
    });

    this.onMessage("startGame", (client, message) => {
      for (const player of this.state.players.values()) {
        if (!player.isReady || !player.hasSong)
          return
      }

      this.state.isStarted = true;

      for (const player of this.state.players.values()) {
        player.score = 0;
        player.misses = 0;
        player.sicks = 0;
        player.goods = 0;
        player.bads = 0;
        player.shits = 0;
        player.hasLoaded = false;
        player.hasEnded = false;
        player.isReady = false;
      }

      this.state.health = 1;

      this.broadcast("gameStarted", "", { afterNextPatch: true });
    });

    this.onMessage("addScore", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.NUMBER)) return;
      if (this.state.isStarted) {
        this.getStatePlayer(client).score += message;
      }
    });

    this.onMessage("addMiss", (client, message) => {
      if (this.state.isStarted) {
        this.getStatePlayer(client).misses += 1;
      }
    });

    this.onMessage("addHitJudge", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.STRING)) return;
      if (this.state.isStarted) {
        switch (message) {
          case "sick":
            this.getStatePlayer(client).sicks += 1;
            break;
          case "good":
            this.getStatePlayer(client).goods += 1;
            break;
          case "bad":
            this.getStatePlayer(client).bads += 1;
            break;
          case "shit":
            this.getStatePlayer(client).shits += 1;
            break;
        }
      }
    });

    this.onMessage("setFSD", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.ARRAY, 6)) return;
      if (this.hasPerms(client)) {
        this.state.folder = message[0];
        this.state.song = message[1];
        this.state.diff = message[2];
        this.chartHash = message[3];
        this.state.modDir = message[4];
        this.state.modURL = message[5];
        this.state.diffList = message[6];

        for (const player of this.state.players) {
          player[1].isReady = false;
          player[1].hasSong = player[0] == client.sessionId;
        }

        this.broadcast("checkChart", "", {afterNextPatch: true});
      }
    });

    this.onMessage("verifyChart", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.STRING)) return;
      this.getStatePlayer(client).hasSong = this.chartHash == message;
    });

    this.onMessage("strumPlay", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.ARRAY, 2)) return;
      if (this.clients[0] == null || this.clients[1] == null) {
        return;
      }

      this.broadcast("strumPlay", message, { except: client });
    });

    this.onMessage("charPlay", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.ARRAY, 0)) return;
      if (this.clients[0] == null || this.clients[1] == null) {
        return;
      }

      this.broadcast("charPlay", message, { except: client });
    });

    this.onMessage("playerReady", (client, message) => {
      this.getStatePlayer(client).hasLoaded = true;

      for (const player of this.state.players.values()) {
        if (!player.hasLoaded)
          return;
      }

      for (const player of this.state.players.values()) {
        player.isReady = false;
      }
      this.broadcast("startSong", "", { afterNextPatch: true });
    });

    this.onMessage("playerEnded", (client, message) => {
      this.getStatePlayer(client).hasEnded = true;

      for (const player of this.state.players.values()) {
        if (!player.hasEnded)
          return;
      }

      this.endSong();
    });

    this.onMessage("noteHit", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.ARRAY, 2)) return;
      if (this.clients[0] == null || this.clients[1] == null) {
        return;
      }

      this.broadcast("noteHit", message, { except: client });

      if (this.playerSide(client)) {
        this.state.health -= 0.023;
      }
      else {
        this.state.health += 0.023;
      }
      
      if (this.state.health > 2)
        this.state.health = 2;
      else if (this.state.health < 0)
        this.state.health = 0;
    });

    this.onMessage("noteMiss", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.ARRAY, 2)) return;
      if (this.clients[0] == null || this.clients[1] == null) {
        return;
      }

      this.broadcast("noteMiss", message, { except: client });

      if (this.playerSide(client)) {
        this.state.health += 0.0475;
      }
      else {
        this.state.health -= 0.0475;
      }

      if (this.state.health > 2)
        this.state.health = 2;
      else if (this.state.health < 0)
        this.state.health = 0;
    });

    this.onMessage("noteHold", (client, message) => {
      if (message != true && message != false) return;
      if (this.clients[0] == null) {
        return;
      }

      this.broadcast("noteHold", message, { except: client });
    });

    this.onMessage("chat", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.STRING)) return; // Fix crash issue from a null value.
      if (message.length >= 300) {
        client.send("log", "The message is too long!");
        return;
      }
      if ((message as String).trim() == "") {
        return;
      }
      this.broadcast("log", "<" + this.getStatePlayer(client).name + ">: " + message);
    });

    this.onMessage("swapSides", (client, message) => {
      if (this.hasPerms(client)) {
        this.state.swagSides = !this.state.swagSides;
      }
    });

    this.onMessage("anarchyMode", (client, message) => {
      if (this.hasPerms(client)) {
        this.state.anarchyMode = !this.state.anarchyMode;
      }
    });

    this.onMessage("pong", (client, message:number) => {
      const stamp = Date.now();
      const daPing = stamp - this.lastPingTime;

      this.getStatePlayer(client).pingStamp = stamp;
      this.getStatePlayer(client).ping = daPing;

      if (this.isOwner(client)) {
        this.metadata.ping = daPing;
      }
    });

    this.onMessage("requestEndSong", (client, message) => {
      //if (this.hasPerms(client)) {
      this.endSong();
      // }
      // else {
      //   this.broadcast("log", this.getStatePlayer(client).name + " wants to end the song! (ESC)");
      // }
    });

    this.onMessage("setGameplaySetting", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.ARRAY, 1)) return;
      if (this.hasPerms(client)) {
        if (message[0] == "instakill" || message[0] == "practice" || message[0] == "opponentplay") {
          return;
        }
        this.state.gameplaySettings.set(message[0], message[1].toString());
      }
    });

    this.onMessage("toggleLocalModifiers", (client, message) => {
      if (this.hasPerms(client)) {
        this.state.permitModifiers = !this.state.permitModifiers;
        if (this.state.permitModifiers) {
          this.state.gameplaySettings = new MapSchema<any, any>();
        }
        else if (!this.checkInvalid(message, VerifyTypes.ARRAY, 0)) {
          for (const key in message[0]) {
            const value = message[0][key].toString();
            if (key == "instakill" || key == "practice" || key == "opponentplay") {
              continue;
            }
            this.state.gameplaySettings.set(key, value);
          }
        }
      }
    });

    this.onMessage("setSkin", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.ARRAY, 2)) {
        this.getStatePlayer(client).skinMod = null;
        this.getStatePlayer(client).skinName = null;
        this.getStatePlayer(client).skinURL = null;
        return;
      }

      this.getStatePlayer(client).skinMod = message[0];
      this.getStatePlayer(client).skinName = message[1];
      this.getStatePlayer(client).skinURL = message[2];
    });

    this.onMessage("updateFP", async (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.NUMBER)) return;

      const user = await getPlayerByID(this.clientsID.get(client));
      const player = this.getStatePlayer(client);
      
      if (player.verified && user) {
        player.points = user.points;
        player.name = user.name;
      }
      else
        player.points = message;

      if (this.isOwner(client)) {
        this.metadata.points = player.points;
      }
    });

    this.onMessage("status", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.STRING) || message.length >= 30) return;

      this.getStatePlayer(client).status = message;
    });

    this.onMessage("setStrum", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.NUMBER)) return;

      // i mean which songs support more strums? (excluding pasta night)
      if (message == 0 || message == 1) {
        this.getStatePlayer(client).strum = message;
      }
    });

    this.onMessage("botplay", (client, _) => {
      this.getStatePlayer(client).botplay = true;
    });

    this.onMessage("updateArrColors", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.ARRAY, 1)) return;

      const player = this.getStatePlayer(client);
      player.arrowColor0 = message[0][0];
      player.arrowColor1 = message[0][1];
      player.arrowColor2 = message[0][2];
      player.arrowColor3 = message[0][3];

      player.arrowColorP0 = message[1][0];
      player.arrowColorP1 = message[1][1];
      player.arrowColorP2 = message[1][2];
      player.arrowColorP3 = message[1][3];
    });

    this.onMessage("command", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.ARRAY, 0)) return;

      switch (message[0]) {
        case "roll":
          this.broadcast("log", "> " + this.getStatePlayer(client).name + " has rolled " + Math.floor(Math.random() * (6 - 1 + 1) + 1));
          break;
        case "kick":
          if (!this.isOwner(client) || !this.clients.at(1) || this.clients.at(1) == client) {
            return;
          }
          this.clients.at(1).leave(4100);
          break;
      }
    });

    this.onMessage("custom", (client, message) => {
      if (this.checkInvalid(message, VerifyTypes.ARRAY, 1)) return;
      this.broadcast("custom", message, { except: client });
    });

    this.clock.setInterval(() => {
      this.lastPingTime = Date.now();
      this.broadcast("ping");
    }, 3000);

    this.clock.setInterval(() => {
      if (this.clients.length <= 0) {
        this.disconnect(4000);
      }
      else {
        for (const player of this.state.players) {
          if (player[1].pingStamp == -1) {
            player[1].pingStamp = 0;
            continue;
          }

          if (Date.now() - player[1].pingStamp > 10000) {
            this.clients.getById(player[0]).leave();
          }
        }
      }
    }, 10000);
  }

  endSong() {
    for (const player of this.state.players.values()) {
      player.isReady = false;
      player.botplay = false;
    }

    this.state.isStarted = false;

    this.broadcast("endSong", "", { afterNextPatch: true });
  }

  async onAuth(client: Client, options: any, request: IncomingMessage) {
    const latestVersion = Data.PROTOCOL_VERSION;
    if (options == null || options.name == null || (options.name + "").trim().length < 3) {
      throw new ServerError(5000, "Too short name!"); // too short name error
    }
    else if (filterUsername(options.name) != options.name) {
      throw new ServerError(5004, "Username contains invalid characters!");
    }
    else if (latestVersion != options.protocol) {
      throw new ServerError(5003, "This client version is not supported on this server, please update!\n\nYour protocol version: '" + options.protocol + "' latest: '" + latestVersion + "'");
    }
    else if (options.name.length > 14) {
      throw new ServerError(5001, "Too long name!"); 
    }

    if (!await this.isClientAllowed(client, request)) {
      throw new ServerError(5002, "Can't join/create 4 servers on the same IP!");
    }

    const playerIp = this.getRequestIP(request);
    const ipInfo = await (await fetch("http://ip-api.com/json/" + playerIp)).json();
    if (process.env["STATS_ENABLED"] == "true" && ipInfo.country) {
      if (!Data.COUNTRY_PLAYERS.hasOwnProperty(ipInfo.country))
        Data.COUNTRY_PLAYERS[ipInfo.country] = [];

      if (!Data.COUNTRY_PLAYERS[ipInfo.country].includes(playerIp))
        Data.COUNTRY_PLAYERS[ipInfo.country].push(playerIp);
    }

    return true;
  }

  async onJoin (client: Client, options: any) {
    let playerName = options.name;
    let playerPoints = options.points;
    let isVerified = false;
    const user = await getPlayerByID(options.networkId);
    if (options.networkId && options.networkToken && user) {
      jwt.verify(options.networkToken, user.secret as string, (err: any, _: any) => {
        if (err) {
          client.error(401, "Couldn't authorize to the network!");
          return;
        }

        isVerified = true;
        this.clientsID.set(client, options.networkId);
        Data.VERIFIED_PLAYING_PLAYERS.push(user.name);
        playerName = user.name;
        playerPoints = user.points;
      })
    }

    if (this.clients.length == 1) {
      this.state.ownerSID = client.sessionId;
    }

    playerName = this.prepareName(playerName);

    const player = new Player();
    this.state.players.set(client.sessionId, player);

    player.name = playerName;
    player.skinMod = options.skinMod;
    player.skinName = options.skinName;
    player.skinURL = options.skinURL;
    player.points = playerPoints;
    player.verified = isVerified;
    player.arrowColor0 = options.arrowRGBT[0];
    player.arrowColor1 = options.arrowRGBT[1];
    player.arrowColor2 = options.arrowRGBT[2];
    player.arrowColor3 = options.arrowRGBT[3];
    player.arrowColorP0 = options.arrowRGBP[0];
    player.arrowColorP1 = options.arrowRGBP[1];
    player.arrowColorP2 = options.arrowRGBP[2];
    player.arrowColorP3 = options.arrowRGBP[3];

    this.broadcast("log", this.getStatePlayer(client).name + " has joined the room!", { afterNextPatch: true });

    client.send("checkChart", "", { afterNextPatch: true });

    this.clock.setTimeout(() => {
      if (client != null)
        client.send("checkChart", "", { afterNextPatch: true });
    }, 1000);
  }

  prepareName(name:String, i?:number):string {
    i++;
    let suffix = i >= 2 ? " (" + i + ")" : "";
    
    for (const player of this.state.players.values()) {
      if (player.name == name + suffix) {
        return this.prepareName(name, i);
      }
    }

    return name + suffix;
  }

  async onLeave (client: Client, consented: boolean) {
    try {
      await this.allowReconnection(client, consented ? 0 : 20);
    }
    catch (err) {
      return this.removePlayer(client);
    }
  }

  async removePlayer(client:Client) {
    // if (this.state.isStarted) {
    //   this.endSong();
    // }
    //else {
    for (const player of this.state.players.values()) {
      player.isReady = false;
    }
    //}

    if (this.clients.length > 0 && this.isOwner(client)) {
      this.state.ownerSID = this.clients[0].sessionId;
    }

    this.broadcast("log", this.getStatePlayer(client).name + " has left the room!");

    this.presence.hset(this.IPS_CHANNEL, this.clientsIP.get(client), ((Number.parseInt(await this.presence.hget(this.IPS_CHANNEL, this.clientsIP.get(client))) - 1) + ""));
    this.clientsIP.delete(client);
    this.clientsID.delete(client);
    Data.VERIFIED_PLAYING_PLAYERS.splice(Data.VERIFIED_PLAYING_PLAYERS.indexOf(this.getStatePlayer(client).name), 1);
    this.state.players.delete(client.sessionId);

    if (this.state.players.size == 0) {
      this.disconnect(4000);
    }
  }

  async onDispose() {
    for (const client of this.clients) {
      this.removePlayer(client);
    }
    this.presence.srem(this.LOBBY_CHANNEL, this.roomId);
  }

  hasPerms(client: Client) {
    return this.isOwner(client) || this.state.anarchyMode;
  }

  isOwner(client: Client) {
    return client.sessionId == this.state.ownerSID;
  }

  playerSide(client: Client) {
    if (this.state.partyMode) {
      return this.getStatePlayer(client).strum == 0;
    }

    return this.state.swagSides ? !this.isOwner(client) : this.isOwner(client);
  }

  getStatePlayer(client:Client):Player {
    return this.state.players.get(client.sessionId);
  }

  checkInvalid(v:any, type: VerifyTypes, indexes?:number) {
    if (v == null) return true;
    switch (type) {
      case VerifyTypes.NUMBER:
        return !Number.isFinite(v);
      case VerifyTypes.STRING:
        return typeof v !== 'string';
      case VerifyTypes.ARRAY:
        if (!indexes) indexes = 0;
        return !Array.isArray(v) || v.length < indexes + 1;
    }
    return false;
  }

  // Generate a single 4 capital letter room ID.
  generateRoomIdSingle(): string {
    let result = '';
    for (var i = 0; i < 4; i++) {
      result += LETTERS.charAt(Math.floor(Math.random() * LETTERS.length));
    }
    return result;
  }

  // 1. Get room IDs already registered with the Presence API.
  // 2. Generate room IDs until you generate one that is not already used.
  // 3. Register the new room ID with the Presence API.
  async generateRoomId(): Promise<string> {
    const currentIds = await this.presence.smembers(this.LOBBY_CHANNEL);
    let id;
    do {
      id = this.generateRoomIdSingle();
    } while (currentIds.includes(id));

    await this.presence.sadd(this.LOBBY_CHANNEL, id);
    return id;
  }

  async isClientAllowed(client: Client, request: IncomingMessage): Promise<Boolean> {
    var requesterIP = this.getRequestIP(request);

    const currentIps = await this.presence.hget(this.IPS_CHANNEL, requesterIP);
    var ipOccurs = !currentIps ? 0 : Number.parseInt(currentIps);
    if (ipOccurs < 4) {
      await this.presence.hset(this.IPS_CHANNEL, requesterIP, (ipOccurs + 1) + "");
      this.clientsIP.set(client, requesterIP);
      return true;
    }
    return false;
  }

  getRequestIP(req: IncomingMessage) {
    if (req.headers['x-forwarded-for']) {
      return (req.headers['x-forwarded-for'] as String).split(",")[0].trim();
    }
    else {
      return req.socket.remoteAddress;
    }
  }
}

enum VerifyTypes {
  NUMBER,
  STRING,
  ARRAY,
}