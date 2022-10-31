import { serve } from "https://deno.land/std@0.156.0/http/server.ts";
import {
  serveFile,
  serveDir,
} from "https://deno.land/std@0.156.0/http/file_server.ts";
import { iterateReader } from "https://deno.land/std@0.156.0/streams/conversion.ts";

const PORT = Deno.env.get("PORT") ?? 8001;

const RTMP_PATH = Deno.env.get("STREAM_RTMP_PATH") ?? "stream";
const RTMP_PORT = Deno.env.get("STREAM_RTMP_PORT") ?? 6000;
const M3U_CT = "application/vnd.apple.mpegurl";

const FFMPEG_PATH = Deno.env.get("FFMPEG_PATH") ?? "";
const FFMPEG_OPTIONS = Deno.env.get("FFMPEG_OPTIONS") ?? "";

// RPC API URL of the IPFS host for pinning
const IPFS_RPC_API =
  Deno.env.get("IPFS_RPC_API") ?? "http://127.0.0.1:5001/api/v0";
// "http://192.168.99.5:5001/api/v0";

// Public gateway URL of the IPFS host
const IPFS_HOST = Deno.env.get("IPFS_HOST") ?? "http://127.0.0.1";
// https://p2p.flak.is

const T_DURATION = 4;
const SEQ_LIVE_SEGMENTS = 5;

// FFmpeg process
let ffproc;

// Live stream
let isLive = false;
let liveRtmpUrl = "";
let liveSegmentsAvail = [];

// IPFS content IDs
let ipfsSegments = [];

serve(
  (req) => {
    const { method, url } = req;
    const path = decodeURIComponent(new URL(url).pathname);

    console.log(`${method} ${path}`);

    if (path == "/status") {
      return new Response(
        JSON.stringify({
          live: isLive,
          vod: liveSegmentsAvail.length > 0,
        }),
        {
          headers: { "content-type": "application/json" },
        }
      );
    }

    if (path == "/ffmpeg/start") {
      ffmpegListen();

      // Empty recorded live segments
      liveSegmentsAvail = [];
      ipfsSegments = [];

      return new Response("OK");
    }

    if (path.endsWith(".ts")) {
      return serveDir(req);
    }
    if (path.startsWith("/ui")) {
      // Serve IPFS stream page by default
      if (path.match(/\/ui(\/(ipfs.html)?)?$/))
        return serveFile(req, "./ui/ipfs.html");

      // Serve classic HTML stream page
      if (path.match(/\/ui\/classic.html/))
        return serveFile(req, "./ui/classic.html");

      // serve other assets
      return serveDir(req);
    }

    if (path.endsWith("live.m3u8")) {
      const contents = path.includes("ipfs") ? m3uLiveIpfs() : m3uLive();
      return new Response(contents, { headers: { "content-type": M3U_CT } });
    } else if (path.endsWith(".m3u8")) {
      const contents = path.includes("ipfs") ? m3uVodIpfs() : m3uVod();
      return new Response(contents, { headers: { "content-type": M3U_CT } });
    }

    return new Response("Waasabi HLS-IPFS PoC");
  },
  { port: PORT }
);

function m3uLiveIpfs() {
  return m3uLive({ ipfs: true });
}
function m3uLive({ ipfs } = {}) {
  const liveEdge = liveSegmentsAvail.length;
  const firstSegment =
    liveEdge > SEQ_LIVE_SEGMENTS ? liveEdge - SEQ_LIVE_SEGMENTS + 1 : 1;

  console.log(`[HLS] Live Playlist: ${firstSegment} => ${liveEdge}`);

  const extinf = liveEdge === 0 ? "" : exts(firstSegment, liveEdge, ipfs);

  return `#EXTM3U
#EXT-X-TARGETDURATION:${T_DURATION}
#EXT-X-VERSION:4
#EXT-X-MEDIA-SEQUENCE:${firstSegment}
${extinf}${isLive ? "" : "#EXT-X-ENDLIST"}
`;
}

function m3uVodIpfs() {
  return m3uVod({ ipfs: true });
}
function m3uVod({ ipfs } = {}) {
  const recordedSegments = liveSegmentsAvail.length;

  console.log(`[HLS] VOD Playlist: 1 => ${recordedSegments}`);

  return `#EXTM3U
#EXT-X-TARGETDURATION:${T_DURATION}
#EXT-X-VERSION:4
#EXT-X-MEDIA-SEQUENCE:1
${exts(1, recordedSegments, ipfs)}#EXT-X-ENDLIST
`;
}

function exts(firstSegment, lastSegment, ipfsUrls = false) {
  let extinf = "";
  let seg = firstSegment;

  while (seg <= lastSegment) {
    extinf =
      extinf +
      `#EXTINF:${T_DURATION * 1.0}\n` +
      (ipfsUrls
        ? ipfsSegments[seg - 1].url
        : "/" + liveSegmentsAvail[seg - 1]) +
      "\n";

    ++seg;
  }

  return extinf;
}

function ffmpegRtmpTranscode(options = {}) {
  const ffmpegPath = options.ffmpegPath ?? "";
  const segmentLength = options.segmentLength ?? 4;
  const rtmpPath = options.rtmpPath ?? RTMP_PATH;
  const rtmpPort = options.rtmpPort ?? RTMP_PORT;
  const crf = options.crf ?? 18;
  const preset = options.preset ?? "fast";
  const fps = options.fps ?? 30;
  const gop = options.gop ?? segmentLength * fps;
  const bitrate = options.bitrate ?? "2800k";
  const maxrate = options.maxrate ?? "3000k";
  const scale = options.scale ?? "-1:720";
  const filename = options.filename ?? "hls/data%04d.ts";
  const playlist = options.playlist ?? "hls/stream.m3u8";

  liveRtmpUrl = `rtmp://localhost:${rtmpPort}/${rtmpPath}`;

  return [
    ffmpegPath + "ffmpeg",
    "-hide_banner",
    "-nostats",
    "-listen",
    1,
    "-i",
    liveRtmpUrl,

    "-c:a",
    "aac",
    "-ac",
    2,

    "-f",
    "hls",
    "-hls_time",
    segmentLength,
    "-hls_playlist_type",
    "vod",

    "-c:v",
    "libx264",
    "-profile:v",
    "main",
    "-crf",
    crf,
    "-preset:v",
    preset,
    "-tune",
    "zerolatency",
    "-sc_threshold",
    0,
    "-g",
    gop,
    "-vf",
    "scale=" + scale,
    "-r",
    fps,

    "-b:v",
    bitrate,
    "-maxrate",
    maxrate,
    "-bufsize",
    "5000k",
    "-b:a",
    "128k",

    "-hls_segment_filename",
    filename,
    playlist,
  ];
}

function ffmpegListen() {
  const ffoptions = {};

  if (FFMPEG_OPTIONS) {
    try {
      const opts = JSON.parse(FFMPEG_OPTIONS);
      Object.assign(ffoptions, opts);
    } catch (e) {
      console.error("Invalid FFMPEG_OPTIONS, string should be valid JSON!", e);
    }
  }

  if (FFMPEG_PATH) {
    ffoptions.ffmpegPath = FFMPEG_PATH;

    ffoptions.env = {
      LD_LIBRARY_PATH: FFMPEG_PATH,
    };
  }

  const ffcmd = ffmpegRtmpTranscode(ffoptions);
  console.log("[ffmpeg] command: ", ffcmd.join(" "));

  ffproc = Deno.run({
    cmd: ffcmd,
    env: ffoptions.env,
    stdout: "piped",
    stderr: "piped",
  });
  console.log(`[ffmpeg] subprocess started (#${ffproc.pid})`);
  console.log(`[ffmpeg] RTMP URL: ` + liveRtmpUrl);

  ffproc.status().then((r) => {
    console.log("[ffmpeg] exited: ", r);
    isLive = false;
  });

  ffmpegLogger(ffproc.stderr);

  return ffproc;
}

async function ffmpegLogger(logstream) {
  const dec = new TextDecoder();

  // ffmpeg will emit progress on the stderr during transcoding
  for await (const value of iterateReader(logstream)) {
    //[hls @ 0x55ac42cc8800] Opening 'hls/data0000.ts' for writing
    const l = dec.decode(value);
    const chunk = (l.match(/Opening '([^']+)/) ?? [])[1];

    if (chunk) {
      isLive = true;
      liveSegmentsAvail.push(chunk);
      console.log(
        `[ffmpeg] ${chunk} now available, total segments: ${liveSegmentsAvail.length}`
      );

      const cid = await ipfsPin(chunk);
      ipfsSegments.push({
        cid,
        url: `${IPFS_HOST}/ipfs/${cid}?filename=data${ipfsSegments.length}.ts`,
      });
      console.log(`[ipfs] ${chunk} pinned on IPFS as ${cid}`);
    }
  }

  console.log("[ffmpeg] No more output, pipe closed.");
}

// Usis the Go IPFS RPC API to upload and pin content on IPFS
// https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-dag-put
async function ipfsPin(file) {
  try {
    const filepath = await Deno.realPath(file);
    // small delay to ensure the chunk has finished writing
    await new Promise((resolve) => setTimeout(resolve, 100));
    const obj = await Deno.readFile(filepath);

    const requestUrl = new URL(IPFS_RPC_API + "/dag/put");

    requestUrl.searchParams.set("store-codec", "raw");
    requestUrl.searchParams.set("input-codec", "raw");
    requestUrl.searchParams.set("pin", "true");
    requestUrl.searchParams.set("hash", "sha2-256");

    const fdata = new FormData();
    fdata.append("file", new Blob([obj]), { type: "video/mp2t" });

    const req = await fetch(requestUrl, {
      method: "POST",
      body: fdata,
    });

    const response = await req.json();
    // Response format:
    /* Cid: {
        '/': 'bafkreia...'
    } */

    // Return the CID of the published file
    return response["Cid"]["/"];
  } catch (e) {
    console.error(e);
  }
}
