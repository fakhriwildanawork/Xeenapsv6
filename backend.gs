/**
 * XEENAPS PKM - SECURE BACKEND V34 (STABLE EXTRACTION)
 * Memperbaiki masalah "EXTRACTION FAILED" dengan memastikan Metadata selalu dikembalikan.
 */

const CONFIG = {
  FOLDERS: {
    MAIN_LIBRARY: '1WG5W6KHHLhKVK-eCq1bIQYif0ZoSxh9t',
    TEMP_AUDIO: '1WG5W6KHHLhKVK-eCq1bIQYif0ZoSxh9t' 
  },
  SPREADSHEETS: {
    LIBRARY: '1NSofMlK1eENfucu2_aF-A3JRwAwTXi7QzTsuPGyFk8w',
    KEYS: '1QRzqKe42ck2HhkA-_yAGS-UHppp96go3s5oJmlrwpc0',
    AI_CONFIG: '1RVYM2-U5LRb8S8JElRSEv2ICHdlOp9pnulcAM8Nd44s'
  },
  PYTHON_API_URL: 'https://xeenaps-v1.vercel.app/api/extract',
  SCHEMAS: {
    LIBRARY: [
      'id', 'title', 'type', 'category', 'topic', 'subTopic', 'author', 'authors', 'publisher', 'year', 
      'source', 'format', 'url', 'fileId', 'tags', 'createdAt', 'updatedAt',
      'inTextAPA', 'inTextHarvard', 'inTextChicago', 'bibAPA', 'bibHarvard', 'bibChicago',
      'researchMethodology', 'abstract', 'summary', 
      'strength', 'weakness', 'unfamiliarTerminology', 'supportingReferences', 
      'videoRecommendation', 'quickTipsForYou',
      'extractedInfo1', 'extractedInfo2', 'extractedInfo3', 'extractedInfo4', 'extractedInfo5',
      'extractedInfo6', 'extractedInfo7', 'extractedInfo8', 'extractedInfo9', 'extractedInfo10'
    ]
  }
};

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'getLibrary') return createJsonResponse({ status: 'success', data: getAllItems(CONFIG.SPREADSHEETS.LIBRARY, "Collections") });
    if (action === 'getAiConfig') return createJsonResponse({ status: 'success', data: getProviderModel('GEMINI') });
    return createJsonResponse({ status: 'error', message: 'Invalid action' });
  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch(e) { return createJsonResponse({ status: 'error', message: 'Malformed JSON' }); }
  const action = body.action;
  
  try {
    if (action === 'setupDatabase') return createJsonResponse(setupDatabase());
    if (action === 'saveItem') {
      const item = body.item;
      if (body.file && body.file.fileData) {
        const folder = DriveApp.getFolderById(CONFIG.FOLDERS.MAIN_LIBRARY);
        const blob = Utilities.newBlob(Utilities.base64Decode(body.file.fileData), body.file.mimeType, body.file.fileName);
        item.fileId = folder.createFile(blob).getId();
      }
      saveToSheet(CONFIG.SPREADSHEETS.LIBRARY, "Collections", item);
      return createJsonResponse({ status: 'success' });
    }
    if (action === 'deleteItem') {
      deleteFromSheet(CONFIG.SPREADSHEETS.LIBRARY, "Collections", body.id);
      return createJsonResponse({ status: 'success' });
    }
    if (action === 'extractOnly') {
      let extractedText = "";
      let fileName = body.fileName || "Extracted Content";
      try {
        if (body.url) extractedText = handleUrlExtraction(body.url);
        else if (body.fileData) {
          const blob = Utilities.newBlob(Utilities.base64Decode(body.fileData), body.mimeType, fileName);
          extractedText = `FILE_NAME: ${fileName}\n\n` + extractTextContent(blob, body.mimeType);
        }
      } catch (err) { extractedText = "Extraction failed: " + err.toString(); }
      return createJsonResponse({ status: 'success', extractedText, fileName });
    }
    if (action === 'aiProxy') return createJsonResponse(handleAiRequest(body.provider, body.prompt, body.modelOverride));
    return createJsonResponse({ status: 'error', message: 'Invalid action' });
  } catch (err) { return createJsonResponse({ status: 'error', message: err.toString() }); }
}

/**
 * 1. METADATA VIA YOUTUBE DATA API V3
 */
function getYoutubeVideoInfo(videoId) {
  const response = YouTube.Videos.list('snippet,contentDetails', { id: videoId });
  if (!response.items || response.items.length === 0) throw new Error("Video not found.");
  const snip = response.items[0].snippet;
  const duration = response.items[0].contentDetails.duration;
  
  // Hashtags & Keywords di YT API v3 ada di snip.tags
  const tags = snip.tags || [];
  
  return {
    title: snip.title,
    channel: snip.channelTitle,
    description: snip.description,
    tags: tags,
    publishedAt: snip.publishedAt,
    duration: duration
  };
}

/**
 * 2. OFFICIAL CAPTIONS
 */
function getYoutubeOfficialCaptions(videoId) {
  const langs = ['en', 'id', 'en-US', 'id-ID'];
  for (let lang of langs) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=srv1`;
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() === 200 && res.getContentText().length > 100) {
        return res.getContentText().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    } catch (e) {}
  }
  return null;
}

/**
 * 3. LOGIKA EKSTRAKSI UTAMA
 */
function handleUrlExtraction(url) {
  const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

  if (isYouTube) {
    let videoId = url.includes('youtu.be/') ? url.split('/').pop().split('?')[0] : (url.match(/v=([^&]+)/) || [])[1];
    if (!videoId) throw new Error("Invalid URL.");

    // TAHAP 1: Metadata Wajib via YT API v3
    const yt = getYoutubeVideoInfo(videoId);
    let metadataStr = `YOUTUBE_METADATA:
Title: ${yt.title}
Channel: ${yt.channel}
Published: ${yt.publishedAt}
Duration: ${yt.duration}
Hashtags: ${yt.tags.slice(0, 5).join(", ")}
Keywords: ${yt.tags.join(", ")}
Description: ${yt.description}
`;

    // TAHAP 2: Cek Transkrip Resmi
    const official = getYoutubeOfficialCaptions(videoId);
    if (official) return metadataStr + "\nOFFICIAL_TRANSCRIPT:\n" + official;

    // TAHAP 3: Jika tidak ada, panggil Vercel (Piped) -> Whisper
    try {
      const vRes = UrlFetchApp.fetch(CONFIG.PYTHON_API_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ url: url }),
        muteHttpExceptions: true
      });
      
      const vJson = JSON.parse(vRes.getContentText());
      if (vJson.status === 'success' && vJson.stream_url) {
        const audio = UrlFetchApp.fetch(vJson.stream_url);
        const transcript = processGroqWhisper(audio.getBlob());
        if (transcript) return metadataStr + "\nWHISPER_TRANSCRIPT:\n" + transcript;
      }
    } catch (e) {
      console.warn("Audio transcript failed: " + e.message);
    }

    // TAHAP 4: Kembalikan Metadata saja jika Whisper gagal (Sesuai Permintaan)
    return metadataStr + "\nTRANSCRIPT_STATUS: UNAVAILABLE. ANALYZE BY METADATA ONLY.";
  }

  // Logika untuk Non-YouTube (Web/Drive) tetap sama
  return handleGenericExtraction(url);
}

function processGroqWhisper(audioBlob) {
  const apiKey = getKeysFromSheet('Groq', 2)[0];
  if (!apiKey) return null;
  const url = "https://api.groq.com/openai/v1/audio/transcriptions";
  const boundary = "-------" + Utilities.getUuid();
  const header = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-large-v3\r\n" +
                 "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.m4a\"\r\nContent-Type: audio/mpeg\r\n\r\n";
  const footer = "\r\n--" + boundary + "--\r\n";
  const body = Utilities.newBlob("").getBytes().concat(Utilities.newBlob(header).getBytes()).concat(audioBlob.getBytes()).concat(Utilities.newBlob(footer).getBytes());
  const res = UrlFetchApp.fetch(url, { method: "post", contentType: "multipart/form-data; boundary=" + boundary, payload: body, headers: { "Authorization": "Bearer " + apiKey }, muteHttpExceptions: true });
  const json = JSON.parse(res.getContentText());
  return json.text || null;
}

function handleGenericExtraction(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const html = res.getContentText();
      return html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "").replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
  } catch (e) {}
  throw new Error("Extraction failed.");
}

function extractTextContent(blob, mimeType) {
  if (mimeType.includes('text/') || mimeType.includes('csv')) return blob.getDataAsString();
  const resource = { name: "Xeenaps_Temp", mimeType: 'application/vnd.google-apps.document' };
  const temp = Drive.Files.create(resource, blob);
  const text = DocumentApp.openById(temp.id).getBody().getText();
  Drive.Files.remove(temp.id);
  return text;
}

function setupDatabase() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEETS.LIBRARY);
  let sheet = ss.getSheetByName("Collections") || ss.insertSheet("Collections");
  sheet.getRange(1, 1, 1, CONFIG.SCHEMAS.LIBRARY.length).setValues([CONFIG.SCHEMAS.LIBRARY]);
  sheet.setFrozenRows(1);
  return { status: 'success', message: 'Database ready.' };
}

function getProviderModel(provider) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEETS.AI_CONFIG);
    const data = ss.getSheetByName('AI').getDataRange().getValues();
    for (let row of data) { if (row[0] && row[0].toString().toUpperCase() === provider.toUpperCase()) return { model: row[1].trim() }; }
  } catch (e) {}
  return { model: provider === 'GEMINI' ? 'gemini-3-flash-preview' : 'whisper-large-v3' };
}

function handleAiRequest(provider, prompt, modelOverride) {
  const keys = (provider === 'groq') ? getKeysFromSheet('Groq', 2) : getKeysFromSheet('ApiKeys', 1);
  const model = modelOverride || getProviderModel(provider).model;
  for (let key of keys) {
    try {
      const res = (provider === 'groq') ? callGroqApi(key, model, prompt) : callGeminiApi(key, model, prompt);
      if (res) return { status: 'success', data: res };
    } catch (e) {}
  }
  return { status: 'error', message: 'AI failed.' };
}

function callGroqApi(key, model, prompt) {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const payload = { model: model, messages: [{ role: "system", content: "AI Librarian. Response in JSON." }, { role: "user", content: prompt }], response_format: { type: "json_object" } };
  const res = UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", headers: { "Authorization": "Bearer " + key }, payload: JSON.stringify(payload), muteHttpExceptions: true });
  return JSON.parse(res.getContentText()).choices[0].message.content;
}

function callGeminiApi(key, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }), muteHttpExceptions: true });
  return JSON.parse(res.getContentText()).candidates[0].content.parts[0].text;
}

function getKeysFromSheet(name, col) {
  try {
    const data = SpreadsheetApp.openById(CONFIG.SPREADSHEETS.KEYS).getSheetByName(name).getRange(2, col, 10, 1).getValues();
    return data.map(r => r[0]).filter(k => k);
  } catch (e) { return []; }
}

function getAllItems(id, name) {
  const sheet = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sheet) return [];
  const vals = sheet.getDataRange().getValues();
  if (vals.length <= 1) return [];
  const headers = vals[0];
  return vals.slice(1).map(row => {
    let item = {};
    headers.forEach((h, i) => {
      let v = row[i];
      if (['tags', 'authors', 'keywords', 'labels'].includes(h)) { try { v = JSON.parse(v || '[]'); } catch(e) { v = []; } }
      item[h] = v;
    });
    return item;
  });
}

function saveToSheet(id, name, item) {
  const sheet = SpreadsheetApp.openById(id).getSheetByName(name);
  sheet.appendRow(CONFIG.SCHEMAS.LIBRARY.map(h => {
    const v = item[h];
    return (Array.isArray(v) || (typeof v === 'object' && v !== null)) ? JSON.stringify(v) : (v || '');
  }));
}

function deleteFromSheet(id, name, itemId) {
  const sheet = SpreadsheetApp.openById(id).getSheetByName(name);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) { if (data[i][0] === itemId) { sheet.deleteRow(i + 1); break; } }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}