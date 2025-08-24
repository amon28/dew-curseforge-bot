import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const API_KEY = process.env.CURSEFORGE_KEY; 
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID; 
const MOD_IDS = [
917260, // Improved Backpack
1288391, //Soul Bound Items
1313134, //Uncrafting table
1316428, //Simple Mob Health
1042095, //Player Graves
1328392, //Quick Deposit
1171565, //Fans and grinders
1096015, //Portal Gun
//1223991, //Spray Paint
//1117484, //One sided glass
1298639, //Superior Torch
1233331, //Item Pedestal
1283902, //NPC Expansion
922661, //Simple Waystone
1021682, //Disenchanter
//1036162, //Dew OreVein miner
//1032357, //Tree capitator
//1210586, //Carry Animals
//1056349, //Player Inventory Sorter
1049942, //Easy Bonsai
//1022840, //Level Storage
//1034810, //Chest Sorter
//1067327, //Auto Inventory
1036647, //Dynamic Lighting
];

const SAVE_FILE = 'lastFileIds.json';

const lastFileIds = loadLastFileIds();

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
  const now = new Date();
  return `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`
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
    const curseForgeProjectUrl = await getProjectLink(modId);
    const mcpedlProjectUrl = `https://mcpedl.com/${curseForgeProjectUrl.split("addons/")[1]}`;

    let textMsg = `# 📢 **${addonName}**`;
    if (changelog.trim() !== "") {
      textMsg += `\n**Changelogs:**\n${formatChangelog(changelog)}`;
    }
    textMsg += `\n**Downloads:**\n🔷 ${mcpedlProjectUrl}\n🔶 ${curseForgeProjectUrl}`;

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

client.once('clientReady', async () => {
  console.log(`➡️ Starting ${getTimeAndDate()}`)
  console.log(`✅ Logged in as ${client.user.tag}`);
  const channel = await client.channels.fetch(CHANNEL_ID);
  //channel.send('✅ Bot is online and can send messages!');

  checkAllMods(); // run immediately on startup
  setInterval(checkAllMods, 60 * 60 * 1000); // 1 hour
});


client.login(process.env.DISCORD_TOKEN);