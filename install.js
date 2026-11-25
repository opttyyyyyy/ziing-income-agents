module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [{
    method: "shell.run",
    params: {
      path: "app",
      message: "npm install"
    }
  }, {
    when: "{{gpu === 'nvidia'}}",
    method: "script.start",
    params: {
      uri: "torch.js",
      params: {
        venv: "env",
        path: "app"
      }
    }
  }, {
    when: "{{gpu === 'nvidia'}}",
    method: "shell.run",
    params: {
      venv: "env",
      path: "app",
      message: "uv pip install -r requirements.txt"
    }
  }, {
    when: "{{gpu === 'nvidia'}}",
    method: "hf.download",
    params: {
      path: "app",
      "_": ["stabilityai/sd-turbo"],
      "local-dir": "models/sd-turbo"
    }
  }]
}
