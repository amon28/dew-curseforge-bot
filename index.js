import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import { DateTime } from 'luxon';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const API_KEY = process.env.CURSEFORGE_KEY; 
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const TEST_CHANNEL_ID = process.env.DISCORD_TEST_CHANNEL_ID
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
  
  MOD_IDS = allMods.map((mod)=>mod.id)
  console.log(`🔃 Getting all addons: ${MOD_IDS.length} | ${getTimeAndDate()}`)
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
}

async function checkModUpdates(modId) {
  const modRes = await fetch(`https://api.curseforge.com/v1/mods/${modId}`, {
    headers: { 'Accept': 'application/json', 'x-api-key': API_KEY }
  });
  if (!modRes.ok) {
    console.error(`❌ Failed to fetch mod info for ${modId}: ${modRes.status} ${modRes.statusText}`);
    return false;
  }
  const modData = (await modRes.json()).data;

  const filesRes = await fetch(`https://api.curseforge.com/v1/mods/${modId}/files`, {
    headers: { 'Accept': 'application/json', 'x-api-key': API_KEY }
  });
  if (!filesRes.ok) {
    console.error(`❌ Failed to fetch files for ${modId}: ${filesRes.status} ${filesRes.statusText}`);
    return false;
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
    lastFileIds[modId] = { name: modData.name, file_id: latest.id };
    saveLastFileIds();

    // Skip if not a Bedrock addon
    if (!latest.fileName.endsWith('.mcaddon') && !latest.fileName.endsWith('.mcpack')) {
      console.log(`⚠️ Skipping ${latest.fileName} — not a Bedrock addon`);
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

    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send(textMsg);

    console.log(`✅ Posted update for addon ${modData.name}`);
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
  const channel = await client.channels.fetch(TEST_CHANNEL_ID);
  
}

//Message channel when bot is running
async function botOnlineMessage(){
  const channel = await client.channels.fetch(TEST_CHANNEL_ID);
  channel.send(`<:mcpedl:1409488865215123547><:curseforge:1409489206786654388>✅ Bot is online and can send messages! ${getTimeAndDate()}`);
}

client.once('clientReady', async () => {
  console.log(`➡️ Starting ${getTimeAndDate()}`)
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  botOnlineMessage()
  //testMessage()
  //console.log(await getRawJsonData(MOD_IDS[1]))
  await getModsByAuthor()
  checkAllMods();
  setInterval(checkAllMods, 60 * 60 * 1000); // 1 hour
  setInterval(getModsByAuthor, 24 * 60 * 60 * 1000);
});


client.login(process.env.DISCORD_TOKEN);