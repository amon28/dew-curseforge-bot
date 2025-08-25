import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import { DateTime } from 'luxon';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const API_KEY = process.env.CURSEFORGE_KEY; 
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID; 
const CREATOR_ID = process.env.CREATOR_ID
const SAVE_FILE = 'lastFileIds.json';
const lastFileIds = loadLastFileIds();
const GAME_ID = 78022 //Minecraft Bedrock

let MOD_IDS = []

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
    const url = `https://api.curseforge.com/v1/mods/search?gameId=${GAME_ID}&authorId=${CREATOR_ID}&pageSize=50&&index=${index}`;
    const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
    const json = await res.json();
    
    // Filter to exact match on author name
    const myMods = json.data.filter((mod)=>mod.authors[0].id == CREATOR_ID)
    allMods = allMods.concat(myMods);

    if (json.data.length < 50) break; // no more pages
    index += 50;
  }
  
  MOD_IDS = allMods.map((mod)=>mod.name)
  console.log(`🔃 Getting all addons: ${MOD_IDS.length} | ${getTimeAndDate()}`)
}


async function getProjectLink(modId) {
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
  return data.data.links.websiteUrl; // e.g. "https://www.curseforge.com/minecraft/mc-addons/my-addon"
}

async function getModSummary(modId) {
  const res = await fetch(`https://api.curseforge.com/v1/mods/${modId}`, {
    headers: { 'x-api-key': API_KEY }
  });
  const data = await res.json();
  return data.data.summary
}

async function getModName(modId) {
  const res = await fetch(`https://api.curseforge.com/v1/mods/${modId}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'x-api-key': API_KEY
    }
  });

  if (!res.ok) {
    console.error(`❌ Failed to fetch mod info for ${modId}: ${res.status} ${res.statusText}`);
    return null;
  }

  const data = await res.json();
  return data.data.name; // This is the mod/project name
}

async function getChangelog(modId, fileId) {
  const res = await fetch(
    `https://api.curseforge.com/v1/mods/${modId}/files/${fileId}/changelog`,
    {
      headers: {
        'Accept': 'application/json',
        'x-api-key': API_KEY
      }
    }
  );

  if (!res.ok) {
    console.error(`❌ Failed to fetch changelog: ${res.status} ${res.statusText}`);
    return null;
  }

  const data = await res.json();
  // The changelog is usually HTML in data.data
  return data.data;
}

function formatChangelog(html) {
  return html
    // Replace list items with "- text"
    .replace(/<li>\s*/gi, '- ')
    .replace(/\s*<\/li>/gi, '\n')
    // Replace paragraph tags with a single newline
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    // Remove all other tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&nbsp;/gi, ' ')
    // Collapse multiple newlines into one
    .replace(/\n\s*\n+/g, '\n')
    // Trim leading/trailing whitespace
    .trim();
}

function getTimeAndDate(){
  const now = DateTime.now().setZone("Asia/Manila")
  const timeAndDate = now.toFormat("M/d/yyyy h:mm:ss a");
  return `${timeAndDate}`
}

async function checkAllMods() {
  console.log(`------------------------------------------------`)
  console.log(`🔷 Checking Addon updates — ${getTimeAndDate()}`);

  let anyUpdated = false; 

  for (const modId of MOD_IDS) {
    try {
      const updated = await checkModUpdates(modId);
      if (updated) {
        anyUpdated = true;
      }
    } catch (err) {
      console.error(`Error checking mod ${modId}:`, err);
    }
  }

  if (!anyUpdated) {
    console.log("ℹ️ There is no addon update.");
  }
}

async function checkModUpdates(modId) {
  const res = await fetch(`https://api.curseforge.com/v1/mods/${modId}/files`, {
    method: 'GET',
    headers: { 
      'Accept': 'application/json',
      'x-api-key': API_KEY 
    }
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ Failed to fetch mod ${modId}: ${res.status} ${res.statusText}`);
    console.error(`Response: ${text}`);
    return false;
  }

  const data = await res.json();

  if (!data.data || data.data.length === 0) {
    console.warn(`⚠️ No files found for mod ${modId}`);
    return false;
  }

  const latest = data.data[0];
  const stored = lastFileIds[modId];

  if (!stored || latest.id !== stored.file_id) {
    const addonName = stored?.name || await getModName(modId);
    lastFileIds[modId] = {
      name: addonName,
      file_id: latest.id
    };
    saveLastFileIds();

    if (!latest.fileName.endsWith('.mcaddon') && !latest.fileName.endsWith('.mcpack')) {
      console.log(`⚠️ Skipping ${latest.fileName} — not a Bedrock addon`);
      return false;
    }

    const channel = await client.channels.fetch(CHANNEL_ID);
    const changelog = await getChangelog(modId, latest.id);
    const summary = await getModSummary(modId)
    const curseForgeProjectUrl = await getProjectLink(modId);
    const mcpedlProjectUrl = `https://mcpedl.com/${curseForgeProjectUrl.split("addons/")[1]}`;

    let textMsg = `# 📢 **${addonName}**`;
    if (changelog.trim() !== "") {
      textMsg += `\n**Changelogs:**\n${formatChangelog(changelog)}`;
    }else{
      textMsg += `\n**New Release**:\n${summary}`
    }
    textMsg += `\n**Downloads:**\n<:mcpedl:1409488865215123547> ${mcpedlProjectUrl}\n<:curseforge:1409489206786654388> ${curseForgeProjectUrl}`;

    await channel.send(textMsg);
    console.log(`✅ Posted update for addon ${addonName}`);
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

// Save IDs to file
function saveLastFileIds() {
  try {
    fs.writeFileSync(SAVE_FILE, JSON.stringify(lastFileIds, null, 2));
  } catch (err) {
    console.error('Error writing save file:', err);
  }
}

//For testing
async function testMessage(){
  const channel = await client.channels.fetch("988605733924900895");
  
}

//Message channel when bot is running
async function botOnlineMessage(){
  const channel = await client.channels.fetch("988605733924900895");
  channel.send(`<:mcpedl:1409488865215123547><:curseforge:1409489206786654388>✅ Bot is online and can send messages! ${getTimeAndDate()}`);
}

client.once('clientReady', async () => {
  console.log(`➡️ Starting ${getTimeAndDate()}`)
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  //checkAllMods(); // run immediately on startup
  botOnlineMessage()
  //testMessage()
  //console.log(await getRawJsonData(MOD_IDS[1]))
  await getModsByAuthor()
  setInterval(checkAllMods, 60 * 60 * 1000); // 1 hour
  setInterval(getModsByAuthor, 24 * 60 * 60 * 1000);
});


client.login(process.env.DISCORD_TOKEN);