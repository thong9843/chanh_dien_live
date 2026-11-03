"""
Chánh Điện Tịnh Tâm — VieNeu TTS Sidecar Service
================================================
Dịch vụ tổng hợp giọng đọc tiếng Việt sử dụng VieNeu-TTS v3 Turbo.
Lắng nghe cục bộ tại 127.0.0.1, cổng mặc định 8765 (hoặc cấu hình qua .env VIENEU_PORT).
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import sys
import unicodedata
import urllib.parse
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Nạp biến môi trường từ .env (tìm ở tts_sidecar, live hoặc thư mục gốc)
BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent
for env_path in [BASE_DIR / ".env", REPO_ROOT / ".env", REPO_ROOT / "live" / ".env"]:
    if env_path.is_file():
        load_dotenv(dotenv_path=env_path)
        break

# Cấu hình logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [VieNeu-Sidecar] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("vieneu_sidecar")

HOST = "127.0.0.1"
PORT = int(os.getenv("VIENEU_PORT", "8765"))
TARGET_DEFAULT_VOICE = "Thiền Tâm Đức"


def strip_accents(s: str) -> str:
    """Loại bỏ dấu tiếng Việt và chuẩn hóa chữ thường để so khớp tên giọng."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower().strip()


def find_preset_voice(target: str, available: list[str]) -> Optional[str]:
    """Tìm giọng đọc phù hợp không phân biệt hoa thường và dấu tiếng Việt."""
    target_clean = target.strip()
    target_lower = target_clean.lower()
    target_norm = strip_accents(target_clean)

    # 1. So khớp chính xác
    for v in available:
        if v.strip() == target_clean:
            return v

    # 2. So khớp không phân biệt hoa thường
    for v in available:
        if v.strip().lower() == target_lower:
            return v

    # 3. So khớp sau khi bỏ dấu
    for v in available:
        if strip_accents(v) == target_norm:
            return v

    # 4. So khớp chuỗi con
    for v in available:
        if target_norm in strip_accents(v):
            return v

    return None


def encode_wav_bytes(audio_arr: np.ndarray, sample_rate: int) -> bytes:
    """Chuyển đổi numpy float32 array thành byte dữ liệu WAV (PCM 16-bit) trong bộ nhớ."""
    if audio_arr.dtype != np.float32:
        audio_arr = np.asarray(audio_arr, dtype=np.float32)
    # Giới hạn biên độ âm thanh [-1.0, 1.0] tránh vỡ tiếng
    audio_arr = np.clip(audio_arr, -1.0, 1.0)
    buf = io.BytesIO()
    sf.write(buf, audio_arr, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class TTSGlobalState:
    def __init__(self):
        self.device: str = "cpu"
        self.engine = None
        self.sample_rate: int = 48000
        self.preset_names: list[str] = []
        self.selected_voice: str = ""
        self.queue_lock = asyncio.Lock()


state = TTSGlobalState()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Khởi tạo model và tải dữ liệu 1 lần duy nhất khi khởi động
    try:
        import torch

        state.device = "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        state.device = "cpu"

    logger.info(f"Khởi tạo VieNeu-TTS (thiết bị: {state.device.upper()})...")

    from vieneu import Vieneu

    try:
        state.engine = Vieneu(device=state.device)
        state.sample_rate = getattr(state.engine, "sample_rate", 48000)
    except Exception as e:
        logger.exception("Lỗi nghiêm trọng khi tải model VieNeu-TTS: %s", e)
        sys.exit(1)

    # Lấy danh sách preset voices
    raw_presets = getattr(state.engine, "_preset_voices", {})
    state.preset_names = list(raw_presets.keys())

    print("\n=======================================================")
    print(f" Danh sách {len(state.preset_names)} giọng mẫu có sẵn của VieNeu-TTS:")
    for name in state.preset_names:
        print(f"   • {name}")
    print("=======================================================\n")

    matched = find_preset_voice(TARGET_DEFAULT_VOICE, state.preset_names)
    if not matched:
        err_msg = (
            f"\n[LỖI NGHIÊM TRỌNG] Không tìm thấy giọng đọc mẫu tương ứng với '{TARGET_DEFAULT_VOICE}'!\n"
            f"Các giọng hiện có: {state.preset_names}\n"
        )
        print(err_msg, file=sys.stderr)
        logger.error(err_msg)
        sys.exit(1)

    state.selected_voice = matched
    logger.info(f"Đã chọn giọng mặc định: '{state.selected_voice}'")

    logger.info("Đang làm nóng (warm-up) model với 1 câu ngắn...")
    try:
        t0 = asyncio.get_event_loop().time()
        _ = state.engine.infer("Nam mô A Di Đà Phật", voice=state.selected_voice)
        elapsed = asyncio.get_event_loop().time() - t0
        logger.info(f"Làm nóng model hoàn tất trong {elapsed:.2f}s.")
    except Exception as e:
        logger.warning(f"Lỗi khi warm-up model (tiếp tục chạy): {e}")

    yield


app = FastAPI(
    title="Chánh Điện VieNeu TTS Sidecar",
    version="3.0.0",
    description="Dịch vụ chuyển văn bản thành giọng đọc tiếng Việt sử dụng VieNeu-TTS",
    lifespan=lifespan,
)

# CORS cục bộ
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:3135",
        "http://localhost:3135",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# Kiểm tra Host header nghiêm ngặt: chỉ chấp nhận 127.0.0.1 hoặc localhost
@app.middleware("http")
async def host_validation_middleware(request: Request, call_next):
    raw_host = request.headers.get("host", "").strip()
    hostname = raw_host.split(":")[0].lower()
    if hostname not in ("127.0.0.1", "localhost"):
        return Response(content="Forbidden: Invalid Host header", status_code=400)
    return await call_next(request)


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Văn bản cần đọc (tối đa 300 ký tự)")
    voice: Optional[str] = Field(default=None, description="Tên giọng đọc trong whitelist preset")
    speed: Optional[float] = Field(default=None, ge=0.5, le=2.0, description="Tốc độ đọc nếu hỗ trợ")


@app.get("/health")
def health():
    return {
        "ok": state.engine is not None,
        "device": state.device,
        "voice": state.selected_voice,
        "sample_rate": state.sample_rate,
        "available_voices": state.preset_names,
    }


@app.post("/tts")
@app.post("/api/tts")
async def synthesize_tts(req: TTSRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Văn bản không được để trống")
    if len(text) > 300:
        raise HTTPException(
            status_code=400,
            detail=f"Văn bản quá dài ({len(text)} ký tự). Tối đa 300 ký tự.",
        )

    # Kiểm tra giọng đọc trong whitelist preset
    voice_to_use = state.selected_voice
    if req.voice and req.voice.strip():
        matched = find_preset_voice(req.voice.strip(), state.preset_names)
        if not matched:
            raise HTTPException(
                status_code=400,
                detail=f"Giọng '{req.voice}' không nằm trong whitelist preset voices: {state.preset_names}",
            )
        voice_to_use = matched

    if not state.engine:
        raise HTTPException(status_code=503, detail="Mô hình TTS chưa sẵn sàng")

    async with state.queue_lock:
        try:
            # Vieneu v3 turbo infer nhận voice=voice_to_use
            audio_arr = await asyncio.to_thread(
                state.engine.infer,
                text,
                voice=voice_to_use,
            )
            wav_bytes = encode_wav_bytes(audio_arr, state.sample_rate)
        except Exception as exc:
            logger.exception("Lỗi sinh âm thanh VieNeu: %s", exc)
            raise HTTPException(status_code=500, detail=f"Lỗi tổng hợp giọng đọc: {exc}") from exc

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'inline; filename="tts.wav"',
            "Cache-Control": "no-store",
            "X-TTS-Voice": urllib.parse.quote(voice_to_use),
            "X-TTS-Device": state.device,
        },
    )


if __name__ == "__main__":
    import uvicorn

    logger.info(f"Khởi động VieNeu TTS Sidecar tại {HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
