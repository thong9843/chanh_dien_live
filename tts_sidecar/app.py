"""
Chánh Điện Tịnh Tâm — VieNeu TTS Sidecar Service
================================================
Service chạy tại http://127.0.0.1:5000 cung cấp API tổng hợp giọng đọc tiếng Việt
chuẩn giọng Miền Nam nhẹ nhàng, điềm đạm, giữ nguyên âm sắc tự nhiên của giọng gốc.

Khởi chạy:
    cd tts_sidecar
    pip install -r requirements.txt
    python app.py
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import re
import tempfile
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

# Cấu hình logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [VieNeu-Sidecar] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("vieneu_sidecar")

BASE_DIR = Path(__file__).resolve().parent
VOICES_DIR = BASE_DIR / "voices"
VOICES_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Cấu hình Giọng Miền Nam Nhẹ Nhàng & Điềm Đạm (Giữ nguyên cao độ giọng gốc)
# ---------------------------------------------------------------------------
VOICE_PROFILES = {
    # Mặc định: Nam miền Nam kể chuyện trầm tĩnh, nhẹ nhàng, điềm đạm
    "nam_trang_nghiem": {
        "candidates": ["Thái Sơn", "Đức Trí", "Nguyên (nam miền Nam)", "Sơn (nam miền Nam)", "Vĩnh (nam miền Nam)", "Adam", "Minh Triết"],
        "gender": "male",
        "region": "nam",
        "speed": 0.96,           # Nhịp đọc điềm đạm tự nhiên như giọng gốc
        "temperature": 0.75,     # Ngữ điệu ổn định, hiền hòa
        "edge_voice": "vi-VN-NamMinhNeural",
        "edge_rate": "-8%",
        "edge_pitch": "+0Hz",
    },
    "duc_tri_nam": {
        "candidates": ["Đức Trí", "Thái Sơn", "Sơn (nam miền Nam)", "Nguyên (nam miền Nam)"],
        "gender": "male",
        "region": "nam",
        "speed": 0.96,
        "temperature": 0.74,
        "edge_voice": "vi-VN-NamMinhNeural",
        "edge_rate": "-8%",
        "edge_pitch": "+0Hz",
    },
    "adam_nam": {
        "candidates": ["Adam", "Thái Sơn", "Vĩnh (nam miền Nam)"],
        "gender": "male",
        "region": "nam",
        "speed": 0.98,
        "temperature": 0.76,
        "edge_voice": "vi-VN-NamMinhNeural",
        "edge_rate": "-5%",
        "edge_pitch": "+0Hz",
    },
    "minh_triet_nam": {
        "candidates": ["Minh Triết", "Thái Sơn", "Đức Trí"],
        "gender": "male",
        "region": "nam",
        "speed": 0.96,
        "temperature": 0.75,
        "edge_voice": "vi-VN-NamMinhNeural",
        "edge_rate": "-6%",
        "edge_pitch": "+0Hz",
    },
    # Nữ miền Nam kể chuyện dịu dàng, thanh thoát
    "nu_thanh_thoat": {
        "candidates": ["Thục Đoan", "Mỹ Duyên", "Kim Thanh", "Thùy Dung", "Đoan (nữ miền Nam)", "Dung (nữ miền Nam)"],
        "gender": "female",
        "region": "nam",
        "speed": 0.96,
        "temperature": 0.75,
        "edge_voice": "vi-VN-HoaiMyNeural",
        "edge_rate": "-8%",
        "edge_pitch": "+0Hz",
    },
    "my_duyen_nu": {
        "candidates": ["Mỹ Duyên", "Thục Đoan", "Kim Thanh"],
        "gender": "female",
        "region": "nam",
        "speed": 0.96,
        "temperature": 0.75,
        "edge_voice": "vi-VN-HoaiMyNeural",
        "edge_rate": "-8%",
        "edge_pitch": "+0Hz",
    },
}


class TTSRequest(BaseModel):
    text: str = Field(
        ...,
        min_length=1,
        max_length=600,
        description="Câu văn bản tiếng Việt cần đọc xướng tên / hồi hướng",
        examples=[
            "Cảm ơn phật tử Nguyễn Văn A đã cúng dường Hoa Sen. Nguyện cầu bình an, phước báu vô lượng."
        ],
    )
    voice_id: str = Field(
        default="nam_trang_nghiem",
        description="Mã giọng đọc (mặc định: nam_trang_nghiem -> Thái Sơn Nam miền Nam)",
    )
    speed: float = Field(
        default=0.96,
        ge=0.65,
        le=1.35,
        description="Tốc độ đọc giữ nguyên cao độ giọng gốc (0.96 = điềm đạm, 1.0 = nguyên bản)",
    )
    response_format: Literal["json", "wav"] = Field(
        default="json",
        description="Trả về JSON chứa Base64 data URI ('json') hoặc binary file .wav ('wav')",
    )


# ---------------------------------------------------------------------------
# Xử lý âm thanh: Giữ nguyên 100% cao độ & âm sắc giọng gốc (WSOLA Time-Stretch)
# ---------------------------------------------------------------------------
def sanitize_vietnamese_text(text: str) -> str:
    """Làm sạch ký tự lạ, emoji và khoảng trắng thừa trước khi đưa vào TTS."""
    cleaned = re.sub(r"https?://\S+", "", text)
    cleaned = re.sub(
        r"[^\w\s,.!?;:()\-–—'\"àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửựỳýỷỹỵđ"
        r"ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]",
        " ",
        cleaned,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or "Nam mô A Di Đà Phật."


def encode_wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    """Xuất trực tiếp mảng float32 [-1, 1] gốc của TTS ra RIFF WAV PCM 16-bit mono (không qua xử lý hậu kỳ)."""
    wav = np.asarray(samples, dtype=np.float32)
    if wav.ndim > 1:
        wav = wav.mean(axis=-1)
    pcm16 = np.clip(wav * 32767.0, -32768, 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm16.tobytes())
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Engine Quản lý VieNeu TTS (Ưu tiên Giọng Miền Nam Điềm Đạm) + Audio Queue Buffer
# ---------------------------------------------------------------------------
class VieNeuEngineManager:
    def __init__(self) -> None:
        self.engine = None
        self.backend_name: str = "uninitialized"
        self.selected_preset_voice: Optional[str] = None
        self.voice_catalog: list[tuple[str, str]] = []  # [(desc, voice_id), ...]
        self.available_voices: list[str] = []
        self.sample_rate: int = 48000
        self.queue_lock = asyncio.Lock()  # Audio Queue Buffer: tuần tự hóa truy cập inference
        self.stats = {"requests": 0, "errors": 0, "started_at": time.time()}

    def initialize(self) -> None:
        precision = os.getenv("VIENEU_PRECISION", "").strip()
        mode = os.getenv("VIENEU_MODE", "").strip()

        # 1. Khởi tạo SDK chính thức `vieneu` (v3 Turbo 48kHz)
        try:
            from vieneu import Vieneu  # type: ignore

            init_kwargs = {}
            if precision:
                init_kwargs["precision"] = precision
            if mode:
                init_kwargs["mode"] = mode

            logger.info("Đang khởi tạo VieNeu TTS SDK %s...", init_kwargs or "(v3turbo 48kHz)")
            self.engine = Vieneu(**init_kwargs)
            self.backend_name = "vieneu"
            self.sample_rate = int(getattr(self.engine, "sample_rate", 48000))
            self._discover_vieneu_voices()
            logger.info(
                "Đã sẵn sàng VieNeu TTS (%d Hz)! Giọng Miền Nam mặc định: %s",
                self.sample_rate,
                self.selected_preset_voice or "default",
            )
            return
        except ImportError:
            logger.warning("Chưa cài đặt gói `vieneu`. Đang kiểm tra `vieneu_tts`...")
        except Exception as exc:
            logger.warning("Không thể khởi tạo `vieneu`: %s", exc)

        # 2. Tương thích ngược `vieneu_tts`
        try:
            from vieneu_tts import VieNeuTTS  # type: ignore

            self.engine = VieNeuTTS()
            self.backend_name = "vieneu_tts"
            self.sample_rate = int(getattr(self.engine, "sample_rate", 24000))
            logger.info("Đã khởi tạo `vieneu_tts` (%d Hz).", self.sample_rate)
            return
        except Exception as exc:
            logger.warning("Không tìm thấy `vieneu_tts`: %s", exc)

        # 3. Fallback `edge_tts` (tự nhiên, không hạ trầm quá mức)
        try:
            import edge_tts  # noqa: F401  # type: ignore

            self.backend_name = "edge_tts_fallback"
            logger.info("Đang chạy chế độ dự phòng `edge_tts` (cao độ tự nhiên +0Hz).")
        except ImportError:
            self.backend_name = "unavailable"
            logger.error("Chưa có `vieneu` hoặc `edge-tts`! Hãy chạy: pip install -r requirements.txt")

    def _discover_vieneu_voices(self) -> None:
        if not self.engine or not hasattr(self.engine, "list_preset_voices"):
            return
        try:
            raw_voices = self.engine.list_preset_voices() or []
            for item in raw_voices:
                if isinstance(item, (tuple, list)) and len(item) >= 2:
                    desc, vid = str(item[0]), str(item[1])
                else:
                    desc, vid = str(item), str(item)
                self.voice_catalog.append((desc, vid))
                self.available_voices.append(vid)

            self.selected_preset_voice = self.resolve_southern_voice("nam_trang_nghiem")
        except Exception as exc:
            logger.warning("Không đọc được danh sách preset voices của VieNeu: %s", exc)

    def resolve_southern_voice(self, requested_id: str) -> Optional[str]:
        """
        Chọn chính xác giọng Miền Nam nhẹ nhàng, điềm đạm từ danh mục VieNeu:
        - Nếu truyền tên preset trực tiếp (VD: 'Thái Sơn', 'Đức Trí', 'Thục Đoan') -> dùng ngay.
        - Nếu truyền mã profile (VD: 'nam_trang_nghiem') -> ưu tiên Thái Sơn / Đức Trí (Nam · Nam),
          tuyệt đối không chọn nhầm giọng miền Bắc.
        """
        if not self.available_voices:
            return None

        # Cho phép truyền trực tiếp tên giọng VieNeu
        if requested_id in self.available_voices:
            return requested_id

        profile = VOICE_PROFILES.get(requested_id, VOICE_PROFILES["nam_trang_nghiem"])
        for cand in profile.get("candidates", []):
            if cand in self.available_voices:
                return cand

        # Tìm kiếm theo mô tả vùng miền "Nam · Nam" / "Nữ · Nam" / "miền Nam"
        want_female = profile.get("gender") == "female"
        for desc, vid in self.voice_catalog:
            d_low = desc.lower()
            is_southern = ("· nam" in d_low) or ("miền nam" in d_low)
            is_northern = ("· bắc" in d_low) or ("miền bắc" in d_low)
            if is_southern and not is_northern:
                if want_female and ("nữ" in d_low or "female" in d_low):
                    return vid
                if not want_female and ("nam" in d_low or "male" in d_low):
                    return vid

        return self.available_voices[0]

    def _infer_vieneu_sync(self, text: str, voice_id: str, speed: float, temperature: float) -> bytes:
        ref_wav = VOICES_DIR / f"{voice_id}.wav"
        audio_arr = None
        sr = int(getattr(self.engine, "sample_rate", self.sample_rate))

        if self.backend_name == "vieneu":
            infer_kwargs: dict = {"text": text, "temperature": temperature}
            if ref_wav.is_file():
                infer_kwargs["ref_audio"] = str(ref_wav)
            else:
                chosen_voice = self.resolve_southern_voice(voice_id)
                if chosen_voice:
                    infer_kwargs["voice"] = chosen_voice

            audio_obj = self.engine.infer(**infer_kwargs)
            if isinstance(audio_obj, tuple) and len(audio_obj) == 2:
                audio_arr, sr = np.asarray(audio_obj[0], dtype=np.float32), int(audio_obj[1])
            elif isinstance(audio_obj, np.ndarray):
                audio_arr = np.asarray(audio_obj, dtype=np.float32)
            elif hasattr(self.engine, "save"):
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    tmp_path = tmp.name
                try:
                    self.engine.save(audio_obj, tmp_path)
                    import soundfile as sf  # type: ignore

                    data, sr = sf.read(tmp_path, dtype="float32")
                    audio_arr = np.asarray(data, dtype=np.float32)
                finally:
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass
            else:
                audio_arr = np.asarray(audio_obj, dtype=np.float32)

        elif self.backend_name == "vieneu_tts":
            infer_fn = getattr(self.engine, "infer", None) or getattr(self.engine, "synthesize", None)
            if not callable(infer_fn):
                raise RuntimeError("Đối tượng VieNeuTTS không hỗ trợ hàm infer()")
            out = infer_fn(text)
            if isinstance(out, tuple) and len(out) == 2:
                audio_arr, sr = np.asarray(out[0], dtype=np.float32), int(out[1])
            else:
                audio_arr = np.asarray(out, dtype=np.float32)

        if audio_arr is None:
            raise RuntimeError("VieNeu không trả về dữ liệu âm thanh")

        return encode_wav_bytes(audio_arr, sr)

    async def _infer_edge_fallback(self, text: str, profile: dict, speed: float) -> tuple[bytes, str]:
        import edge_tts  # type: ignore

        rate_pct = int(round((speed - 1.0) * 100))
        rate_str = f"{rate_pct:+d}%"
        pitch_str = profile.get("edge_pitch", "+0Hz")
        voice = profile.get("edge_voice", "vi-VN-NamMinhNeural")

        communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate_str, pitch=pitch_str)
        mp3_chunks: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio" and chunk.get("data"):
                mp3_chunks.append(chunk["data"])
        if not mp3_chunks:
            raise RuntimeError("Edge TTS dự phòng không sinh được âm thanh")
        return b"".join(mp3_chunks), "audio/mpeg"

    async def synthesize(self, req: TTSRequest) -> tuple[bytes, str, str]:
        clean_text = sanitize_vietnamese_text(req.text)
        profile = VOICE_PROFILES.get(req.voice_id, VOICE_PROFILES["nam_trang_nghiem"])
        speed = float(req.speed or profile["speed"])
        temperature = float(profile.get("temperature", 0.75))
        resolved_voice = self.resolve_southern_voice(req.voice_id) or req.voice_id

        async with self.queue_lock:
            self.stats["requests"] += 1
            if self.backend_name in ("vieneu", "vieneu_tts"):
                wav_bytes = await asyncio.to_thread(
                    self._infer_vieneu_sync,
                    clean_text,
                    req.voice_id,
                    speed,
                    temperature,
                )
                return wav_bytes, "audio/wav", resolved_voice

            if self.backend_name == "edge_tts_fallback":
                mp3_bytes, mime = await self._infer_edge_fallback(clean_text, profile, speed)
                return mp3_bytes, mime, profile.get("edge_voice", "vi-VN-NamMinhNeural")

            self.stats["errors"] += 1
            raise HTTPException(
                status_code=503,
                detail="Chưa cài đặt engine TTS (`pip install vieneu` hoặc `pip install edge-tts`).",
            )


tts_manager = VieNeuEngineManager()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    tts_manager.initialize()
    yield


app = FastAPI(
    title="Chánh Điện VieNeu TTS Sidecar",
    version="2.1.0",
    description="Dịch vụ tổng hợp giọng đọc Miền Nam nhẹ nhàng, điềm đạm như giọng gốc cho Chánh Điện Online",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {
        "ok": tts_manager.backend_name != "unavailable",
        "backend": tts_manager.backend_name,
        "preset_voice": tts_manager.selected_preset_voice,
        "sample_rate": tts_manager.sample_rate,
        "available_voices": tts_manager.available_voices,
        "default_profile": {
            "voice_id": "nam_trang_nghiem",
            "resolved_voice": tts_manager.selected_preset_voice,
            "speed": 0.96,
            "pitch_shift": 0.0,
        },
        "stats": tts_manager.stats,
    }


@app.post("/api/tts")
async def synthesize_tts(
    payload: TTSRequest,
    format: Optional[Literal["json", "wav"]] = Query(default=None),
):
    out_fmt = format or payload.response_format
    t0 = time.perf_counter()
    try:
        audio_bytes, mime_type, resolved_voice = await tts_manager.synthesize(payload)
    except HTTPException:
        raise
    except Exception as exc:
        tts_manager.stats["errors"] += 1
        logger.exception("Lỗi tổng hợp giọng đọc: %s", exc)
        raise HTTPException(status_code=500, detail=f"Lỗi tổng hợp TTS: {exc}") from exc

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    ext = "wav" if mime_type == "audio/wav" else "mp3"
    logger.info(
        "Đã đọc [%s (%s) | %.2fx | %sms]: %s",
        payload.voice_id,
        resolved_voice,
        payload.speed,
        elapsed_ms,
        payload.text[:72],
    )

    if out_fmt == "wav":
        return Response(
            content=audio_bytes,
            media_type=mime_type,
            headers={
                "Content-Disposition": f'inline; filename="tts_chanhdien.{ext}"',
                "Cache-Control": "no-store",
                "X-TTS-Backend": tts_manager.backend_name,
                "X-TTS-Voice": resolved_voice,
                "X-TTS-Elapsed-Ms": str(elapsed_ms),
            },
        )

    b64 = base64.b64encode(audio_bytes).decode("ascii")
    return JSONResponse(
        content={
            "ok": True,
            "backend": tts_manager.backend_name,
            "voice_id": payload.voice_id,
            "resolved_voice": resolved_voice,
            "speed": payload.speed,
            "mime": mime_type,
            "ext": ext,
            "elapsed_ms": elapsed_ms,
            "audio_base64": b64,
            "data_uri": f"data:{mime_type};base64,{b64}",
        }
    )


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("TTS_HOST", "127.0.0.1")
    port = int(os.getenv("TTS_PORT", "5000"))
    uvicorn.run(app, host=host, port=port, log_level="info")
