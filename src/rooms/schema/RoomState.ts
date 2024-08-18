import { Schema, MapSchema, type } from "@colyseus/schema";
import { Player } from "./Player";

export class RoomState extends Schema {
  @type("string") song:string = "";
  @type("string") folder: string = "";
  @type("number") diff: number = 1;
  @type({array: "string"}) diffList: string[] = [];
  @type("string") modDir: string = "";
  @type("string") modURL: string = "";
  @type("boolean") isPrivate: boolean = true;
  @type("boolean") isStarted: boolean = false;
  @type("boolean") swagSides: boolean = false;
  @type("boolean") anarchyMode: boolean = false;
  @type("number") health: number = 0.0;
  @type({ map: "string" }) gameplaySettings = new MapSchema<string>();
  @type("boolean") permitModifiers: boolean = false;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") ownerSID: string = "";
  @type("boolean") partyMode: boolean = false;
}
