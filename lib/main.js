import "./editor/preview.css"
import "./css/notyf.min.css"
import "./css/material_icons.css"
import { Notyf } from "notyf"
import {
  Scene,
  Color,
  OrthographicCamera,
  WebGLRenderer,
  AmbientLight,
  DirectionalLight,
  BoxGeometry,
  MeshBasicMaterial,
  DoubleSide,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  PCFSoftShadowMap,
} from "three"
import WebGPURenderer from "three/src/renderers/webgpu/WebGPURenderer.js"
import * as ADOFAI from "./lib/adofai/index.js"
import Hjson from "hjson"
import createTrackMesh from "./geo/mesh_reserve.js"
import example from "./lib/example/line.json"
import "./control/saveAs.js"

var notyf = new Notyf({
  position: {
    x: "right",
    y: "bottom",
  },
  duration: 3000,
  dismissible: true,
  types: [
    { type: "success", background: "green" },
    { type: "warning", background: "yellow" },
    { type: "error", background: "red" },
  ],
})

let _Previewer
let fileInput

class Previewer {
  constructor(adofaiFile) {
    this.container = document.getElementById("container")
    this.fpsCounter = document.getElementById("fps-counter")
    this.info = document.getElementById("info")

    // 动画控制
    this.animationId = null
    this.isDisposed = false

    // Calcute FramePerSecond
    this.frameCount = 0
    this.lastTime = performance.now()
    this.fps = 0

    // Camera-Controlling
    this.isDragging = false
    this.previousMousePosition = { x: 0, y: 0 }
    this.cameraPosition = { x: 0, y: 0 }
    this.zoom = 1
    this.minZoom = 0
    this.maxZoom = 240

    this.tiles = new Map()
    this.visibleTiles = new Set()
    this.tileLimit = 0 // 0 Means no limit

    this.adofaiFile = adofaiFile

    // 绑定事件处理函数到实例
    this.boundEventHandlers = {
      mouseDown: this.onMouseDown.bind(this),
      mouseMove: this.onMouseMove.bind(this),
      mouseUp: this.onMouseUp.bind(this),
      wheel: this.onWheel.bind(this),
      touchStart: this.onTouchStart.bind(this),
      touchMove: this.onTouchMove.bind(this),
      touchEnd: this.onTouchEnd.bind(this),
      windowResize: this.onWindowResize.bind(this),
      contextMenu: (e) => e.preventDefault(),
    }

    this.init()
    this.setupEventListeners()
    this.animate()
  }

  // 添加清理方法
  dispose() {
    console.log("Disposing Previewer...")
    this.isDisposed = true

    // 停止动画循环
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }

    // 移除事件监听器
    this.removeEventListeners()

    // 清理Three.js资源
    this.cleanupThreeJS()

    // 清理DOM
    this.cleanupDOM()

    console.log("Previewer disposed successfully")
  }

  removeEventListeners() {
    if (this.renderer && this.renderer.domElement) {
      const canvas = this.renderer.domElement
      canvas.removeEventListener("mousedown", this.boundEventHandlers.mouseDown)
      canvas.removeEventListener("mousemove", this.boundEventHandlers.mouseMove)
      canvas.removeEventListener("mouseup", this.boundEventHandlers.mouseUp)
      canvas.removeEventListener("wheel", this.boundEventHandlers.wheel)
      canvas.removeEventListener("touchstart", this.boundEventHandlers.touchStart)
      canvas.removeEventListener("touchmove", this.boundEventHandlers.touchMove)
      canvas.removeEventListener("touchend", this.boundEventHandlers.touchEnd)
      canvas.removeEventListener("contextmenu", this.boundEventHandlers.contextMenu)
    }

    window.removeEventListener("resize", this.boundEventHandlers.windowResize)
  }

  cleanupThreeJS() {
    // 清理所有tile meshes
    this.tiles.forEach((mesh) => {
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => mat.dispose())
        } else {
          mesh.material.dispose()
        }
      }
      if (this.scene) {
        this.scene.remove(mesh)
      }
    })
    this.tiles.clear()
    this.visibleTiles.clear()

    // 清理材质
    if (this.tileMaterials) {
      this.tileMaterials.forEach((material) => {
        if (material.dispose) material.dispose()
      })
      this.tileMaterials = null
    }

    // 清理几何体
    if (this.tileGeometry) {
      this.tileGeometry.dispose()
      this.tileGeometry = null
    }

    // 清理场景中的所有对象
    if (this.scene) {
      while (this.scene.children.length > 0) {
        const child = this.scene.children[0]
        if (child.geometry) child.geometry.dispose()
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose())
          } else {
            child.material.dispose()
          }
        }
        this.scene.remove(child)
      }
      this.scene = null
    }

    // 清理渲染器
    if (this.renderer) {
      this.renderer.dispose()
      this.renderer = null
    }

    // 清理相机
    this.camera = null
  }

  cleanupDOM() {
    // 移除canvas元素
    if (this.container) {
      const canvas = this.container.querySelector("canvas")
      if (canvas) {
        this.container.removeChild(canvas)
      }
    }
  }

  generateMockData() {
    return this.adofaiFile.tiles // Declare the variable before using it
  }

  init() {
    // 创建场景
    this.scene = new Scene()
    this.scene.background = new Color(0xf9f9f9)

    // 创建摄像机 (正交摄像机更适合2D)
    const aspect = window.innerWidth / window.innerHeight
    const frustumSize = 20
    this.camera = new OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      1,
      1000,
    )
    this.camera.position.z = 10

    // 创建渲染器
    let t
    if (false && navigator.gpu) {
      t = WebGPURenderer
    } else {
      t = WebGLRenderer
    }
    this.renderer = new t({ antialias: true })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)

    // 添加光源
    const ambientLight = new AmbientLight(0x404040, 0.6)
    this.scene.add(ambientLight)

    const directionalLight = new DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 10, 5)
    directionalLight.castShadow = true
    this.scene.add(directionalLight)

    // 创建砖块几何体和材质
    this.tileGeometry = new BoxGeometry(1, 0.65, 0.2)
    this.tileMaterials = this.createTileMaterials()

    this.updateVisibleTiles()
  }

  createTileMaterials() {
    const materials = []
    const colors = [
      0xdebb7b,
      0xffd700, // 金色
      0xff69b4, // 热粉色
      0x90ee90, // 浅绿色
      0x87ceeb, // 天蓝色
      0xffa500, // 橙色
      0xda70d6, // 紫罗兰色
      0xffffff,
      0xff00ff,
    ]

    colors.forEach((color) => {
      const m = new MeshBasicMaterial({
        vertexColors: true,
        side: DoubleSide,
      })
      m.color = new Color(color)
      m.opacity = 0.5
      materials.push(m)
    })

    return materials
  }

  createTransparentTileWithMergedGeometry(meshData, opacity, color) {
    const geometry = new BufferGeometry()
    geometry.setIndex(meshData.faces)
    geometry.setAttribute("position", new Float32BufferAttribute(meshData.vertices, 3))
    geometry.setAttribute("color", new Float32BufferAttribute(meshData.colors, 3))
    geometry.computeVertexNormals()

    const material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: opacity,
      side: DoubleSide,
      depthWrite: false, // 禁用深度写入以避免排序问题
    })

    // 如果需要整体颜色调制
    if (color) {
      material.color = new Color(color)
    }

    return new Mesh(geometry, material)
  }

  setupEventListeners() {
    // 使用绑定的事件处理函数
    this.renderer.domElement.addEventListener("mousedown", this.boundEventHandlers.mouseDown)
    this.renderer.domElement.addEventListener("mousemove", this.boundEventHandlers.mouseMove)
    this.renderer.domElement.addEventListener("mouseup", this.boundEventHandlers.mouseUp)
    this.renderer.domElement.addEventListener("wheel", this.boundEventHandlers.wheel)

    // 触摸事件（双指缩放）
    this.renderer.domElement.addEventListener("touchstart", this.boundEventHandlers.touchStart)
    this.renderer.domElement.addEventListener("touchmove", this.boundEventHandlers.touchMove)
    this.renderer.domElement.addEventListener("touchend", this.boundEventHandlers.touchEnd)

    // 窗口大小调整
    window.addEventListener("resize", this.boundEventHandlers.windowResize)

    // 防止右键菜单
    this.renderer.domElement.addEventListener("contextmenu", this.boundEventHandlers.contextMenu)
  }

  onMouseDown(event) {
    if (this.isDisposed) return
    this.isDragging = true
    this.previousMousePosition = {
      x: event.clientX,
      y: event.clientY,
    }
  }

  onMouseMove(event) {
    if (this.isDisposed || !this.isDragging) return

    const deltaX = event.clientX - this.previousMousePosition.x
    const deltaY = event.clientY - this.previousMousePosition.y

    // 根据缩放调整移动速度
    const moveSpeed = 0.02 / this.zoom
    this.cameraPosition.x -= deltaX * moveSpeed
    this.cameraPosition.y += deltaY * moveSpeed

    this.previousMousePosition = {
      x: event.clientX,
      y: event.clientY,
    }

    this.updateCamera()
  }

  onMouseUp() {
    if (this.isDisposed) return
    this.isDragging = false
  }

  onWheel(event) {
    if (this.isDisposed) return
    event.preventDefault()

    const zoomSpeed = 0.1
    const zoomFactor = event.deltaY > 0 ? 1 - zoomSpeed : 1 + zoomSpeed

    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor))
    this.updateCamera()
  }

  // 触摸事件处理
  onTouchStart(event) {
    if (this.isDisposed) return
    if (event.touches.length === 1) {
      this.isDragging = true
      this.previousMousePosition = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
      }
    } else if (event.touches.length === 2) {
      this.initialPinchDistance = this.getPinchDistance(event.touches)
      this.initialZoom = this.zoom
    }
  }

  onTouchMove(event) {
    if (this.isDisposed) return
    event.preventDefault()

    if (event.touches.length === 1 && this.isDragging) {
      const deltaX = event.touches[0].clientX - this.previousMousePosition.x
      const deltaY = event.touches[0].clientY - this.previousMousePosition.y

      const moveSpeed = 0.02 / this.zoom
      this.cameraPosition.x -= deltaX * moveSpeed
      this.cameraPosition.y += deltaY * moveSpeed

      this.previousMousePosition = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
      }

      this.updateCamera()
    } else if (event.touches.length === 2) {
      const currentPinchDistance = this.getPinchDistance(event.touches)
      const zoomFactor = currentPinchDistance / this.initialPinchDistance

      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.initialZoom * zoomFactor))
      this.updateCamera()
    }
  }

  onTouchEnd() {
    if (this.isDisposed) return
    this.isDragging = false
  }

  getPinchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  updateCamera() {
    if (this.isDisposed) return
    this.camera.position.x = this.cameraPosition.x
    this.camera.position.y = this.cameraPosition.y

    // 更新正交摄像机的视锥体
    const aspect = window.innerWidth / window.innerHeight
    const frustumSize = 20 / this.zoom

    this.camera.left = (frustumSize * aspect) / -2
    this.camera.right = (frustumSize * aspect) / 2
    this.camera.top = frustumSize / 2
    this.camera.bottom = frustumSize / -2
    this.camera.updateProjectionMatrix()

    this.updateVisibleTiles()
  }

  updateVisibleTiles() {
    if (this.isDisposed) return
    // 计算摄像机能看到的范围
    const aspect = window.innerWidth / window.innerHeight
    const frustumSize = 20 / this.zoom

    const left = this.cameraPosition.x - (frustumSize * aspect) / 2
    const right = this.cameraPosition.x + (frustumSize * aspect) / 2
    const bottom = this.cameraPosition.y - frustumSize / 2
    const top = this.cameraPosition.y + frustumSize / 2

    // 清除当前可见的砖块
    this.visibleTiles.forEach((tileId) => {
      if (this.tiles.has(tileId)) {
        this.scene.remove(this.tiles.get(tileId))
      }
    })
    this.visibleTiles.clear()

    // 找到在视野范围内的砖块
    let visibleTileIds = []
    visibleTileIds = Object.keys(this.adofaiFile.tiles).filter((id) => {
      const tile = this.adofaiFile.tiles[id]
      const [x, y] = tile.position
      return x >= left - 1 && x <= right + 1 && y >= bottom - 1 && y <= top + 1
    })

    // 应用limit限制
    let tilesToRender = visibleTileIds
    if (this.tileLimit > 0 && visibleTileIds.length > this.tileLimit) {
      // 按距离摄像机的距离排序，优先渲染近的
      tilesToRender = visibleTileIds
        .map((id) => {
          const tile = this.adofaiFile.tiles[id]
          const [x, y] = tile.position
          const distance = Math.sqrt(Math.pow(x - this.cameraPosition.x, 2) + Math.pow(y - this.cameraPosition.y, 2))
          return { id, distance }
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, this.tileLimit)
        .map((item) => item.id)
    }

    // 创建或重用砖块mesh
    tilesToRender.forEach((id, index) => {
      const tile = this.adofaiFile.tiles[id - 1]
      const [x, y] = tile?.position || [0, 0]

      let tileMesh
      if (this.tiles.has(id)) {
        tileMesh = this.tiles.get(id)
      } else {
        // 计算层级（第一个砖块层级12，后续递减）
        const zLevel = 12 - Number.parseInt(id)
        const materialIndex = Number.parseInt(id) % this.tileMaterials.length

        let pred = (this.adofaiFile.tiles[id - 1]?.direction || 0) - 180
        if (this.adofaiFile.tiles[id - 1]?.direction == 999) {
          pred = this.adofaiFile.tiles[id - 2]?.direction || 0
          //pred -= 180;
        }
        const pred2 = this.adofaiFile.tiles[id]?.direction || 0

        const meshdata = createTrackMesh(pred, pred2, this.adofaiFile.tiles[id]?.direction == 999)

        const mesh = new BufferGeometry()

        mesh.setIndex(meshdata.faces)
        mesh.setAttribute("position", new Float32BufferAttribute(meshdata.vertices, 3))
        mesh.setAttribute("color", new Float32BufferAttribute(meshdata.colors, 3))
        mesh.computeVertexNormals()

        tileMesh = new Mesh(mesh, this.tileMaterials[materialIndex])
        tileMesh.position.set(x, y, zLevel * 0.01) // 微小的z差异来实现层级
        tileMesh.castShadow = true
        tileMesh.receiveShadow = true

        this.tiles.set(id, tileMesh)
      }

      this.scene.add(tileMesh)
      this.visibleTiles.add(id)
    })
  }

  updateFPS() {
    if (this.isDisposed) return
    this.frameCount++
    const currentTime = performance.now()

    // 每0.5秒更新一次FPS显示
    if (currentTime - this.lastTime >= 500) {
      this.fps = (this.frameCount * 1000) / (currentTime - this.lastTime)
      if (this.fpsCounter) {
        this.fpsCounter.textContent = `FPS  ${this.fps.toFixed(2)}`
      }

      // 更新信息显示
      if (this.info) {
        this.info.innerHTML = `
                    <div>Camera Position (${this.cameraPosition.x.toFixed(2)}, ${this.cameraPosition.y.toFixed(2)})</div>
                    <div>Zoom ${this.zoom.toFixed(2)}</div>
                    <div>Horizon ${this.visibleTiles.size}</div>
                    <div>Total ${Object.keys(this.adofaiFile.tiles).length}</div>
                `
      }

      this.frameCount = 0
      this.lastTime = currentTime
    }
  }

  onWindowResize() {
    if (this.isDisposed) return
    const aspect = window.innerWidth / window.innerHeight
    const frustumSize = 20 / this.zoom

    this.camera.left = (frustumSize * aspect) / -2
    this.camera.right = (frustumSize * aspect) / 2
    this.camera.top = frustumSize / 2
    this.camera.bottom = frustumSize / -2
    this.camera.updateProjectionMatrix()

    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.updateVisibleTiles()
  }

  animate() {
    if (this.isDisposed) return

    this.animationId = requestAnimationFrame(this.animate.bind(this))
    this.updateFPS()
    this.renderer.render(this.scene, this.camera)
  }
}

// 启动应用
window.addEventListener("load", () => {
  fileInput = document.createElement("input")
  fileInput.type = "file"
  fileInput.id = "fileInput"
  fileInput.classList.add("hidden")
  fileInput.addEventListener("change", handleFileSelection)
  document.querySelector("#butload").addEventListener("click", () => {
    fileInput.click()
  })
  globalThis.adofaiFile = new ADOFAI.Level(example, Hjson)
  adofaiFile.on("load", (e) => {
    e.calculateTileCoordinates()
    if (_Previewer) {
      console.log("Disposing old Previewer...")
      _Previewer.dispose()
      _Previewer = null
    }

    _Previewer = new Previewer(e)
    notyf.success("载入关卡成功!")
  })
  adofaiFile.load().catch((e) => {
    notyf.error("载入关卡失败!", e)
  })
})

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "o") {
    e.preventDefault()
    fileInput.click()
  }
})

function handleFileSelection() {
  const file = fileInput.files[0]
  if (!file) return

  // 使用FileReader读取文件内容
  const reader = new FileReader()

  reader.onload = (ev) => {
    const adofaiContent = ev.target.result
    globalThis.adofaiFile = new ADOFAI.Level(adofaiContent, Hjson) // Declare the variable before using it
    adofaiFile.on("load", (e) => {
      e.calculateTileCoordinates()

      // 关键修改：在创建新的Previewer之前，先清理旧的
      if (_Previewer) {
        console.log("Disposing old Previewer...")
        _Previewer.dispose()
        _Previewer = null
      }

      // 创建新的Previewer
      _Previewer = new Previewer(e)
      notyf.success("载入关卡成功!")
    })
    adofaiFile.load().catch((e) => {
      notyf.error("载入关卡失败!")
      console.error(e)
    })
  }

  reader.onerror = () => {
    notyf.error("文件读取失败!")
  }

  reader.readAsText(file)
}

// 页面卸载时清理资源
window.addEventListener("beforeunload", () => {
  if (_Previewer) {
    _Previewer.dispose()
  }
})
