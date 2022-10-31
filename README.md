# Waasabi HLS-IPFS proof of concept

Peer-to-peer video- and live streaming experiment for the [Waasabi](https://waasabi.org) system. This proof-of-concept demonstrates publishing live and on-demand video streams on the IPFS network (using libp2p) and accessing them from a web browser.

This initial proof of concept is part of a research endeavor for building a better, more accessible live streaming system that relies on the viewers for additional distribution bandwidth, making it easier for individuals to create online events without large investment into streaming infrastructure, or being forced to rely on infrastructure provided free-of-charge, but never truly "free" by large tech giants.

Furthermore, a custom streaming server makes further user experience experimentation for Waasabi possible, even for features that would not be possible with the usual suspects listed above (e.g. instant, per-talk replays, disjunct live streams with custom experiences in the breaks, etc.).

[Project page on the Waasabi website](https://waasabi.org/projects/waasabi-p2p.html)

## Running

The demo requires [ffmpeg](https://ffmpeg.org) installed on the local machine, and access to the [Kubo RPC API](https://docs.ipfs.tech/reference/kubo/rpc/). The later could be running on the local machine (e.g. [IPFS Desktop](https://docs.ipfs.tech/install/ipfs-desktop/)), or a public deployed node (in this case you will need to configure access through SSH/VPN or run the demo on the node).

The RPC API URL (`IPFS_RPC_API`), the public IPFS gateway address(`IPFS_HOST`), ffmpeg path (`FFMPEG_PATH`) and ffmpeg options (`FFMPEG_OPTIONS`) can be configured using environment variables, see `.env.example`. A note for FFMPEG options: this should be a JSON object, check `ffmpegRtmpTranscode` for the configuration options. Note when tweaking these options that you will need to keep the HLS segment size under 1MB otherwise have Kubo complain.

Once all prerequisites met, you will need [Deno](https://deno.land/) (1.25 or later) to run the server. You will need to [grant runtime permissions](https://deno.land/manual@v1.27.0/runtime/permission_apis) for environment variables, networking and files, use `--allow-read`, `--allow-net` and `--allow-env`, or use `-A` in `deno run`:

```
$ deno run -A hlsrtmp.js
```

The server starts up listening on localhost, on port `8001` (this can be changed with the PORT env variable).

To start the RTMP listener you need to send a GET request to `/ffmpeg/start`.

```
$ curl http://localhost:8001/ffmpeg/start
```

This will start the RTMP service on `rtmp://localhost:6000/stream` (port and path configurable via `STREAM_RTMP_PORT` / `STREAM_RTMP_PATH`). Use [OBS Studio](https://obsproject.com/), ffmpeg or any other RTMP-compatible tool to start a live stream to the given address. ffmpeg will start generating an HLS segmented video stream from the incoming video stream, and the server will pick it up and publish it to your chosen pinning IPFS server.

The server will also generate an HLS live manifest (and, once the stream is stopped, a VOD recording manifest) to play back the video using standard http HLS using the public web gateway for IPFS built into Kubo -- in the future this feature will be largely intended to be used as a fallback mechanism, with more p2p distribution mechanisms prototyped and fine-tuned.

All this sounds like too much hassle? [Check out the demo video on the website!](https://waasabi.org/projects/waasabi-p2p.html)
