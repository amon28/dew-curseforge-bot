import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import { DateTime } from 'luxon';
import {formatChangelog} from './utils/changelogFormatter.js';

dotenv.config();

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
]});

const API_KEY = process.env.CURSEFORGE_KEY; 
const CREATOR_ID = process.env.CREATOR_ID
const SAVE_FILE = 'lastFileIds.json';
const lastFileIds = loadLastFileIds();
const GAME_ID = 78022 //Minecraft Bedrock
const CHANNEL_MAP_PATH = "channelMap.json"
const channelMap = loadChannelMap();
const CHANNEL_IDS = channelMap['announcement'];
const TEST_CHANNEL_IDS = channelMap['test']
const CONFIG_FILE = 'config.json'
const CONFIG = loadConfig()
const CHECK_ALL_MODS_UPDATE_TIME = CONFIG['CHECK_ALL_MODS_UPDATE_TIME']
const REGET_ALL_MODS_TIME = CONFIG['REGET_ALL_MODS_TIME']

// Validate required environment variables
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ Missing required environment variable: DISCORD_TOKEN');
  process.exit(1);
}
if (!API_KEY) {
  console.error('❌ Missing required environment variable: CURSEFORGE_KEY');
  process.exit(1);
}
if (!CREATOR_ID) {
  console.error('❌ Missing required environment variable: CREATOR_ID');
  process.exit(1);
}

let MOD_IDS = []
let isCheckingMods = false // Prevent concurrent runs causing duplicates

async function getRawJsonData(modId) {
  const res = await fetch(`https://api.curseforge.com/v1/mods/${modId}`, {
  headers: {
    'Accept': 'application/json',
    'x-api-key': API_KEY
  }
  });

  if (!res.ok) {
    console.error(`❌ Failed to fetch mod info: ${res.status} ${res.statusText}`);
    return null;
  }

  const data = await res.json();
  return data.data
}

async function getModsByAuthor() {
  let index = 0;
  let allMods = [];

  while(true){
    const url = `https://api.curseforge.com/v1/mods/search?gameId=${GAME_ID}&authorId=${CREATOR_ID}&pageSize=50&index=${index}`;
    const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
    const json = await res.json();
    
    // Filter to exact match on author name
    const myMods = json.data.filter((mod)=>mod.authors[0].id == CREATOR_ID)
    allMods = allMods.concat(myMods);

    if (json.data.length < 50) break; // no more pages
    index += 50;
  }
  
  MOD_IDS = allMods.map((mod)=>mod.id)
  console.log(`🔃 Getting all addons: ${MOD_IDS.length} | ${getTimeAndDate()}`)
}

function getTimeAndDate(){
  const now = DateTime.now().setZone("Asia/Manila")
  const timeAndDate = now.toFormat("M/d/yyyy h:mm:ss a");
  return `${timeAndDate}`
}

async function checkAllMods() {
  if (isCheckingMods) {
    console.log("⏭️ Skipping — a check is already in progress.");
    return;
  }
  isCheckingMods = true;

  try {
    console.log(`------------------------------------------------`)
    console.log(`🔷 Checking Addon updates — ${getTimeAndDate()}`);

    let anyUpdated = false;
    let update_success = 0
    let no_updates = 0

    for (const modId of MOD_IDS) {
      try {
        const updated = await checkModUpdates(modId);
        if (updated) {
          anyUpdated = true;
          update_success++
        }else{
          no_updates++
        }
      } catch (err) {
        console.error(`Error checking mod ${modId}:`, err);
      }
    }

    if (!anyUpdated) {
      console.log("ℹ️ There is no addon update.");
    }else{
      console.log(`➡️ Updated: ${update_success}`)
      console.log(`➡️ No Updates: ${no_updates}`)
    }
    update_success = 0
    no_updates = 0
  } finally {
    isCheckingMods = false;
  }
}

async function checkModUpdates(modId) {
  const modRes = await fetch(`https://api.curseforge.com/v1/mods/${modId}`, {
    headers: { 'Accept': 'application/json', 'x-api-key': API_KEY }
  });
  if (!modRes.ok) {
    console.error(`❌ Failed to fetch mod info for ${modId}: ${modRes.status} ${modRes.statusText}`);
    throw new Error(`API error fetching mod ${modId}: ${modRes.status} ${modRes.statusText}`);
  }
  const modData = (await modRes.json()).data;

  const filesRes = await fetch(`https://api.curseforge.com/v1/mods/${modId}/files`, {
    headers: { 'Accept': 'application/json', 'x-api-key': API_KEY }
  });
  if (!filesRes.ok) {
    console.error(`❌ Failed to fetch files for ${modId}: ${filesRes.status} ${filesRes.statusText}`);
    throw new Error(`API error fetching files for mod ${modId}: ${filesRes.status} ${filesRes.statusText}`);
  }
  const filesData = await filesRes.json();
  if (!filesData.data || filesData.data.length === 0) {
    console.warn(`⚠️ No files found for mod ${modId}`);
    return false;
  }

  const latest = filesData.data[0];
  const stored = lastFileIds[modId];

  // Check if new file
  if (!stored || latest.id !== stored.file_id) {

    // Skip if not a Bedrock addon (save ID early to avoid re-checking non-addon files)
    if (!latest.fileName.endsWith('.mcaddon') && !latest.fileName.endsWith('.mcpack')) {
      console.log(`⚠️ Skipping ${latest.fileName} — not a Bedrock addon`);
      lastFileIds[modId] = { name: modData.name, file_id: latest.id };
      saveLastFileIds();
      return false;
    }

    const changelogRes = await fetch(
      `https://api.curseforge.com/v1/mods/${modId}/files/${latest.id}/changelog`,
      { headers: { 'Accept': 'application/json', 'x-api-key': API_KEY } }
    );
    const changelog = changelogRes.ok ? (await changelogRes.json()).data : "";

    // Build message
    const curseForgeProjectUrl = modData.links.websiteUrl;
    const mcpedlProjectUrl = `https://mcpedl.com/${curseForgeProjectUrl.split("addons/")[1]}`;

    let textMsg = `# 📢 **${modData.name}**`;
    if (changelog.trim() !== "") {
      textMsg += `\n**Changelogs:**\n${formatChangelog(changelog)}`;
    } else {
      textMsg += `\n**New Release**:\n${modData.summary}`;
    }
    textMsg += `\n**Downloads:**\n<:mcpedl:1409488865215123547> ${mcpedlProjectUrl}\n<:curseforge:1409489206786654388> ${curseForgeProjectUrl}`;

    let postSuccess = true;
    for(let CHANNEL_ID of CHANNEL_IDS){
      try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        await channel.send(textMsg);
      } catch (err) {
        console.error(`❌ Failed to post to channel ${CHANNEL_ID}:`, err);
        postSuccess = false;
      }
    }

    // Only save file ID after posting succeeds, preventing duplicates on crash/restart
    lastFileIds[modId] = { name: modData.name, file_id: latest.id };
    saveLastFileIds();

    if (postSuccess) {
      console.log(`✅ Posted update for addon ${modData.name}`);
    } else {
      console.warn(`⚠️ Partial failure posting update for addon ${modData.name}`);
    }
    return true;
  }
  return false;
}

// Load saved IDs from file (if it exists)
function loadLastFileIds() {
  if (fs.existsSync(SAVE_FILE)) {
    try {
      const data = fs.readFileSync(SAVE_FILE, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Error reading save file:', err);
    }
  }
  return {};
}

function loadChannelMap(){
  if (fs.existsSync(CHANNEL_MAP_PATH)) {
    try {
      const data = fs.readFileSync(CHANNEL_MAP_PATH, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Error reading save file:', err);
    }
  }
  const defaultValue = {
    'announcement':[],
    'test':[]
  }
  return defaultValue;
}

function loadConfig(){
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Error reading save file:', err);
    }
  }
  const defaultValue = {
    "_comment": "All time values are in hours",
    'CHECK_ALL_MODS_UPDATE_TIME': 1,
    'REGET_ALL_MODS_TIME': 6
  }
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultValue, null, 2));
  } catch (err) {
    console.error('Error writing save file:', err);
  }
  return defaultValue
}

// Save IDs to file
function saveLastFileIds() {
  try {
    fs.writeFileSync(SAVE_FILE, JSON.stringify(lastFileIds, null, 2));
  } catch (err) {
    console.error('Error writing save file:', err);
  }
}

function saveChannelMap() {
  try {
    fs.writeFileSync(CHANNEL_MAP_PATH, JSON.stringify(channelMap, null, 2));
  } catch (err) {
    console.error('Error writing save file:', err);
  }
}

//For testing
async function testMessage(){
  for(let CHANNEL_ID of TEST_CHANNEL_IDS){
    const channel = await client.channels.fetch(CHANNEL_ID);
  }
}

//Message channel when bot is running
async function botOnlineMessage(){
  for(let CHANNEL_ID of TEST_CHANNEL_IDS){
    const channel = await client.channels.fetch(CHANNEL_ID);
    channel.send(`<:mcpedl:1409488865215123547><:curseforge:1409489206786654388>✅ Bot is online and can send messages! ${getTimeAndDate()}`);
  }
}

client.once('clientReady', async () => {
  console.log(`➡️ Starting ${getTimeAndDate()}`)
  console.log(`➡️ Reget Time ${REGET_ALL_MODS_TIME}`)
  console.log(`➡️ Update Time ${CHECK_ALL_MODS_UPDATE_TIME}`)
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  botOnlineMessage()
  //testMessage()
  //console.log(await getRawJsonData(MOD_IDS[1]))
  await getModsByAuthor()
  checkAllMods();
  setInterval(checkAllMods, CHECK_ALL_MODS_UPDATE_TIME * 60 * 60 * 1000); // 1 hour
  setInterval(getModsByAuthor, REGET_ALL_MODS_TIME * 60 * 60 * 1000);
});

client.on("messageCreate", async (message) => {
  if (!message.content.startsWith("/daub")) return;
  if (!message.guild || !message.member) return;
  if (!message.member.permissions.has("Administrator")) {
    return message.reply("❌ You need admin permissions to set the update channel.");
  }

  const subCommandArgs = message.content.split(" ")
  const mainSubCommand = subCommandArgs[1]?.trim().toLowerCase();

  if (!mainSubCommand) {
    return message.reply("⚠️ Please specify a subcommand (e.g., `/daub setchannel`).");
  }

  switch(mainSubCommand){
    case "setchannel":
      console.log(`🔃Set Channel Command Ran. ${getTimeAndDate()}`)
      var channelType = subCommandArgs[2]?.trim().toLowerCase();
      var channelId = subCommandArgs[3]?.trim().toLowerCase();
      if(!channelType){
        return message.reply("⚠️ Please specify a channel type (e.g., `announcement`).");
      }
      if (!channelMap[channelType]) {
        return message.reply(`⚠️ Unknown channel type: \`${channelType}\`. Valid types: ${Object.keys(channelMap).join(", ")}`);
      }
      if(!channelId){
        return message.reply("⚠️ Please specify a valid channel Id.");
      }    
      if (!channelMap[channelType].includes(channelId)) {
        channelMap[channelType].push(channelId);
        saveChannelMap();
        message.reply(`✅ ${channelType} channel set to <#${channelId}>`);
        console.log(`✅ ${channelType} channel set to <#${channelId}>`)
      } else {
        message.reply(`⚠️ Channel <#${channelId}> is already set for \`${channelType}\`.`);
        console.log(`⚠️ Channel <#${channelId}> is already set for \`${channelType}\`.`)
      }
    break;

    case "removechannel": 
      console.log(`🔃Clear Channel Command Ran. ${getTimeAndDate()}`)
      var channelType = subCommandArgs[2]?.trim().toLowerCase();
      var channelId = subCommandArgs[3]?.trim();

      if (!channelType || !channelMap[channelType]) {
        return message.reply(`⚠️ Unknown channel type: \`${channelType}\`. Valid types: ${Object.keys(channelMap).join(", ")}`);
      }

      if (!channelId) {
        return message.reply("⚠️ Please specify a valid channel ID to remove.");
      }

      const index = channelMap[channelType].indexOf(channelId);
      if (index === -1) {
        return message.reply(`⚠️ Channel <#${channelId}> is not set for \`${channelType}\`.`);
      }

      channelMap[channelType].splice(index, 1);
      saveChannelMap();
      message.reply(`🗑️ Removed channel <#${channelId}> from \`${channelType}\`.`);
      console.log(`🗑️ Removed channel <#${channelId}> from \`${channelType}\`.`)
    break;

    case "listchannels":
      const lines = Object.entries(channelMap).map(([type, ids]) => {
        return `**${type}**: ${ids.map(id => `<#${id}>`).join(", ") || "None"}`;
      });
      message.reply(`📋 Saved channels:\n${lines.join("\n")}`);
    break;

    case "ping":
      const entries = Object.entries(channelMap)
      for(let [type, ids] of entries){
        for(let channelId of ids){
          const channel = await client.channels.fetch(channelId);
          await channel.send(`✅Ping ${type}!`);
        }
      }
    break;

    case "clearchannel":
      console.log(`🔃Clear Channel Command Ran. ${getTimeAndDate()}`)
      const typeToClear = subCommandArgs[2]?.trim().toLowerCase();
      if (!channelMap[typeToClear]) {
        return message.reply(`⚠️ Unknown channel type: \`${typeToClear}\`.`);
      }
      channelMap[typeToClear] = [];
      saveChannelMap();
      message.reply(`🧹 Cleared all channels for \`${typeToClear}\`.`);
    break;

    case "raw_changelog":
      var modId = subCommandArgs[2]?.trim().toLowerCase();
      if(!modId){
        return message.reply("⚠️ Please specify a mod ID.");
      }
      const filesRes = await fetch(`https://api.curseforge.com/v1/mods/${modId}/files`, {
        headers: { 'Accept': 'application/json', 'x-api-key': API_KEY }
      });
      if (!filesRes.ok) {
        return message.reply(`❌ Failed to fetch files for ${modId}: ${filesRes.status} ${filesRes.statusText}`);
      }
      const filesData = await filesRes.json();
      if (!filesData.data || filesData.data.length === 0) {
        return message.reply(`⚠️ No files found for mod ${modId}`);
      }

      const latest = filesData.data[0];

      const changelogRes = await fetch(
        `https://api.curseforge.com/v1/mods/${modId}/files/${latest.id}/changelog`,
        { headers: { 'Accept': 'application/json', 'x-api-key': API_KEY } }
      );
      const changelog = changelogRes.ok ? (await changelogRes.json()).data : "";
      message.reply(`📜 Raw Changelog:\n\`\`\`${changelog}\`\`\``);
    break;

    case "changelog":
      var modId = subCommandArgs[2]?.trim().toLowerCase();
      if(!modId){
        return message.reply("⚠️ Please specify a mod ID.");
      }
      const filesRes2 = await fetch(`https://api.curseforge.com/v1/mods/${modId}/files`, {
        headers: { 'Accept': 'application/json', 'x-api-key': API_KEY }
      });
      if (!filesRes2.ok) {
        return message.reply(`❌ Failed to fetch files for ${modId}: ${filesRes2.status} ${filesRes2.statusText}`);
      }
      const filesData2 = await filesRes2.json();
      if (!filesData2.data || filesData2.data.length === 0) {
        return message.reply(`⚠️ No files found for mod ${modId}`);
      }

      const latest2 = filesData2.data[0];

      const changelogRes2 = await fetch(
        `https://api.curseforge.com/v1/mods/${modId}/files/${latest2.id}/changelog`,
        { headers: { 'Accept': 'application/json', 'x-api-key': API_KEY } }
      );
      const changelog2 = changelogRes2.ok ? (await changelogRes2.json()).data : "";
      const formattedChangelog = formatChangelog(changelog2);
      message.reply(`📜 Formatted Changelog:\n${formattedChangelog}`);
    break;

    case "force_reupdate":
      console.log(`🔃Forced Re-Update Command Ran. ${getTimeAndDate()}`)
      for(let CHANNEL_ID of TEST_CHANNEL_IDS){
        const channel = await client.channels.fetch(CHANNEL_ID);
        channel.send(`✅ Force Re-Update Successfully Ran.`);
      }
      await getModsByAuthor()
      checkAllMods();
    break;

    case "test":
      console.log(`🧪 Test Message Command Ran. ${getTimeAndDate()}`)
      // Send to test channels
      for (let CHANNEL_ID of TEST_CHANNEL_IDS){
        try {
          const channel = await client.channels.fetch(CHANNEL_ID);
          await channel.send(`🧪 *TEST — Fake Update*\n# 📢 **Test Addon v1.0.0**\n**Changelogs:**\n- This is a test message\n- Feature A added\n- Bug B fixed\n**Downloads:**\n<:mcpedl:1409488865215123547> https://example.com/test\n<:curseforge:1409489206786654388> https://example.com/test`);
        } catch (err) {
          console.error(`❌ Failed to post test message to channel ${CHANNEL_ID}:`, err);
        }
      }
      // Also send to announcement channels so you can verify formatting
      for (let CHANNEL_ID of CHANNEL_IDS){
        try {
          const channel = await client.channels.fetch(CHANNEL_ID);
          await channel.send(`🧪 *TEST — Fake Update*\n# 📢 **Test Addon v1.0.0**\n**Changelogs:**\n- This is a test message\n- Feature A added\n- Bug B fixed\n**Downloads:**\n<:mcpedl:1409488865215123547> https://example.com/test\n<:curseforge:1409489206786654388> https://example.com/test`);
        } catch (err) {
          console.error(`❌ Failed to post test message to channel ${CHANNEL_ID}:`, err);
        }
      }
      message.reply('✅ Test messages sent to **test** and **announcement** channels.');
    break;

    case "help":
        message.reply(`📖 **Daub Bot Commands**
      \`\`\`
      /daub force_reupdate                  → Recheck for updates
      /daub test                            → Send a simulated fake update
      /daub setchannel <type> <channelId>   → Save a channel for updates
      /daub removechannel <type> <channelId> → Remove a saved channel
      /daub listchannels                    → Show all saved channels
      /daub clearchannel <type>            → Clear all channels of a type
      /daub ping                            → Pings all channel in config
      /daub changelog <modId>               → Show formatted changelog of latest file
      /daub raw_changelog <modId>           → Show raw changelog of latest file
      /daub help                            → Show this help message
      \`\`\``);
    break;

    default:
      message.reply("⚠️ Please specify a valid subcommand (e.g., `/daub help`).");
  }
});

client.login(process.env.DISCORD_TOKEN);