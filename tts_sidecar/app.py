"""
Chánh Điện Tịnh Tâm — VieNeu TTS Sidecar Service
================================================
Dịch vụ tổng hợp giọng đọc tiếng Việt sử dụng VieNeu-TTS v3 Turbo.
Lắng nghe cục bộ tại 127.0.0.1, cổng mặc định 8765 (hoặc cấu hình qua .env VIENEU_PORT).
"""

from __future__ import annotations

import asyncio
import importlib.metadata
import io
import logging
import os
import sys
import unicodedata
import urllib.parse
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

# Nạp biến môi trường từ .env (tìm ở tts_sidecar, live hoặc thư mục gốc) TRƯỚC khi nạp numpy/onnxruntime,
# vì số luồng tính toán phải đặt trước khi các thư viện đó khởi tạo.
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent
for env_path in [BASE_DIR / ".env", REPO_ROOT / ".env", REPO_ROOT / "live" / ".env"]:
    if env_path.is_file():
        load_dotenv(dotenv_path=env_path)
        break

# VIENEU_THREADS (trong .env): số luồng CPU cho model, mặc định 2 để không tranh CPU với overlay/trình duyệt khi máy không có GPU.
# Bỏ qua hoàn toàn khi đã cài bản GPU của onnxruntime (CUDA): GPU tự lo, không giới hạn luồng.
try:
    CPU_THREADS = max(1, min(32, int(os.getenv("VIENEU_THREADS", "2"))))
except ValueError:
    CPU_THREADS = 2


def _gpu_runtime_installed() -> bool:
    try:
        importlib.metadata.version("onnxruntime-gpu")
        return True
    except importlib.metadata.PackageNotFoundError:
        return False


GPU_BUILD = _gpu_runtime_installed()
if not GPU_BUILD:
    for _k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[_k] = str(CPU_THREADS)

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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


def lower_process_priority() -> str:
    """Hạ ưu tiên tiến trình xuống BelowNormal (Windows) / nice +10 (Linux, macOS): giọng đọc không bao giờ giành CPU của overlay đang phát."""
    try:
        if sys.platform == "win32":
            import ctypes

            BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            if ctypes.windll.kernel32.SetPriorityClass(handle, BELOW_NORMAL_PRIORITY_CLASS):
                return "below_normal"
            return "unchanged"
        os.nice(10)
        return "nice+10"
    except Exception as exc:  # không đặt được ưu tiên thì vẫn chạy bình thường
        logging.getLogger("vieneu_sidecar").warning("Không hạ được ưu tiên tiến trình: %s", exc)
        return "unchanged"


def limit_cpu_threads(n: int) -> None:
    """Chỉ dùng khi chạy CPU: ép mọi phiên onnxruntime (và PyTorch nếu có) dùng tối đa n luồng."""
    try:
        import onnxruntime as ort

        orig_init = ort.InferenceSession.__init__

        def patched(self, path_or_bytes, sess_options=None, *args, **kwargs):
            if sess_options is None:
                sess_options = ort.SessionOptions()
            if not getattr(sess_options, "intra_op_num_threads", 0):
                sess_options.intra_op_num_threads = n
                sess_options.inter_op_num_threads = 1
            return orig_init(self, path_or_bytes, sess_options, *args, **kwargs)

        ort.InferenceSession.__init__ = patched
    except Exception as exc:
        logging.getLogger("vieneu_sidecar").warning("Không giới hạn được luồng onnxruntime: %s", exc)
    try:
        import torch

        torch.set_num_threads(n)
    except Exception:
        pass


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


def encode_mp3_bytes(audio_arr: np.ndarray, sample_rate: int) -> bytes:
    """Chuyển đổi numpy float32 array thành MP3 bytes trong bộ nhớ (tiết kiệm ~20x dung lượng so với WAV)."""
    if audio_arr.dtype != np.float32:
        audio_arr = np.asarray(audio_arr, dtype=np.float32)
    # Giới hạn biên độ âm thanh [-1.0, 1.0] tránh vỡ tiếng
    audio_arr = np.clip(audio_arr, -1.0, 1.0)
    buf = io.BytesIO()
    sf.write(buf, audio_arr, sample_rate, format="MP3")
    return buf.getvalue()


class TTSGlobalState:
    def __init__(self):
        self.device: str = "cpu"
        self.engine = None
        self.sample_rate: int = 48000
        self.preset_names: list[str] = []
        self.selected_voice: str = ""
        self.threads: int = 0
        self.priority: str = "unchanged"
        self.queue_lock = asyncio.Lock()


state = TTSGlobalState()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Phát hiện thiết bị GPU/CUDA (onnxruntime-gpu hoặc PyTorch CUDA), tự động fallback về CPU nếu không có hoặc lỗi
    detected_gpu = False
    try:
        import torch
        if torch.cuda.is_available():
            detected_gpu = True
    except Exception:
        pass

    try:
        import onnxruntime as ort
        if "CUDAExecutionProvider" in ort.get_available_providers():
            detected_gpu = True
    except Exception:
        pass

    state.device = "cuda" if detected_gpu else "cpu"
    state.priority = lower_process_priority()
    if state.device == "cpu":
        limit_cpu_threads(CPU_THREADS)
        state.threads = CPU_THREADS
        logger.info(f"Chạy CPU: giới hạn {CPU_THREADS} luồng (VIENEU_THREADS), ưu tiên tiến trình {state.priority}")
    else:
        state.threads = 0
        logger.info(f"Chạy CUDA GPU: bỏ qua VIENEU_THREADS, ưu tiên tiến trình {state.priority}")
    logger.info(f"Khởi tạo VieNeu-TTS (thiết bị dự kiến: {state.device.upper()})...")

    from vieneu import Vieneu

    try:
        if state.device == "cuda":
            try:
                state.engine = Vieneu(device="cuda")
                logger.info("✓ VieNeu-TTS đã khởi chạy thành công trên CUDA GPU")
            except Exception as gpu_err:
                logger.warning(f"Không thể khởi chạy trên CUDA ({gpu_err}), chuyển sang CPU fallback...")
                state.device = "cpu"
                state.engine = Vieneu(device="cpu")
        else:
            state.engine = Vieneu(device="cpu")
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
        "threads": state.threads,
        "priority": state.priority,
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
            mp3_bytes = encode_mp3_bytes(audio_arr, state.sample_rate)
        except Exception as exc:
            logger.exception("Lỗi sinh âm thanh VieNeu: %s", exc)
            raise HTTPException(status_code=500, detail=f"Lỗi tổng hợp giọng đọc: {exc}") from exc

    return Response(
        content=mp3_bytes,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": 'inline; filename="tts.mp3"',
            "Cache-Control": "no-store",
            "X-TTS-Voice": urllib.parse.quote(voice_to_use),
            "X-TTS-Device": state.device,
        },
    )


if __name__ == "__main__":
    import uvicorn

    logger.info(f"Khởi động VieNeu TTS Sidecar tại {HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
