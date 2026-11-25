import base64
import io
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

NEGATIVE = (
    "color, colored, colourful, shading, shaded, gradient, gray, grayscale, "
    "photograph, realistic, 3d render, text, letters, numbers, watermark, "
    "signature, frame, border, background scene, messy lines, cross hatching"
)

PIPELINES = {}


def resolve_model(name):
    if name == "sdxl-turbo":
        return "stabilityai/sdxl-turbo"
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "sd-turbo")
    if os.path.isdir(local):
        return local
    return "stabilityai/sd-turbo"


def get_pipeline(name):
    if name in PIPELINES:
        return PIPELINES[name]
    import torch
    from diffusers import EulerAncestralDiscreteScheduler
    from diffusers import StableDiffusionPipeline, StableDiffusionXLPipeline

    model = resolve_model(name)
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    if name == "sdxl-turbo":
        pipe = StableDiffusionXLPipeline.from_pretrained(model, torch_dtype=dtype)
    else:
        pipe = StableDiffusionPipeline.from_pretrained(model, torch_dtype=dtype, safety_checker=None)
    pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(
        pipe.scheduler.config, timestep_spacing="trailing"
    )
    if torch.cuda.is_available():
        pipe = pipe.to("cuda")
    PIPELINES[name] = pipe
    return pipe


def render(payload):
    name = payload.get("model") or "sd-turbo"
    if name not in ("sd-turbo", "sdxl-turbo"):
        name = "sd-turbo"
    pipe = get_pipeline(name)
    steps = max(1, min(8, int(payload.get("steps") or 2)))
    size = 1024 if name == "sdxl-turbo" else 512
    prompt = str(payload.get("prompt") or "")
    image = pipe(
        prompt=prompt,
        negative_prompt=NEGATIVE,
        num_inference_steps=steps,
        guidance_scale=0.0,
        width=size,
        height=size,
    ).images[0]
    image = image.resize((2048, 2048), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.send_json(200, {"ok": True})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            self.send_json(200, {"image": render(payload)})
        except Exception as error:
            self.send_json(500, {"error": str(error)})

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    port = int(os.environ.get("PORT") or 8765)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
