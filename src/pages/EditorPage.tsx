"use client"

import type React from "react"
import { useEffect, useRef, useState, useCallback } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Home, Settings, Save, Upload, Download } from "lucide-react"
import { useTheme } from "@/hooks/use-theme"
import { useI18n } from "@/lib/i18n/context"
import * as THREE from "three"
import * as ADOFAI from "adofai"
import Hjson from "hjson"
import createTrackMesh from "@/lib/Geo/mesh_reserve"
import example from "@/lib/example/line.json"
import type { JSX } from "react/jsx-runtime"

// 声明全局类型
declare global {
  interface Window {
    showNotification?: (type: string, message: string) => void
  }
  interface Navigator {
    gpu?: any
  }
}

// 播放状态枚举
enum PlaybackState {
  HOLDING = "holding",
  PLAYING = "playing",
}

// 星球接口
interface Planet {
  id: number
  mesh: THREE.Mesh
  color: THREE.Color
  angle: number
  isCenter: boolean
  tileIndex: number
}

// 通知系统组件
function NotificationSystem(): JSX.Element {
  const [notifications, setNotifications] = useState<Array<{ id: number; type: string; message: string }>>([])

  const addNotification = useCallback((type: string, message: string): void => {
    const id = Date.now()
    setNotifications((prev) => [...prev, { id, type, message }])
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    }, 3000)
  }, [])

  // 暴露给全局使用
  useEffect(() => {
    window.showNotification = addNotification
  }, [addNotification])

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`px-4 py-2 rounded-lg text-white font-medium shadow-lg transition-all duration-300 ${
            notification.type === "success"
              ? "bg-green-500"
              : notification.type === "warning"
                ? "bg-yellow-500"
                : notification.type === "error"
                  ? "bg-red-500"
                  : "bg-blue-500"
          }`}
        >
          {notification.message}
        </div>
      ))}
    </div>
  )
}

class Previewer {
  private container: HTMLElement
  private fpsCounter: HTMLElement
  private info: HTMLElement
  private animationId: number | null = null
  private isDisposed = false
  private frameCount = 0
  private lastTime: number = performance.now()
  private fps = 0
  private isDragging = false
  private previousMousePosition: { x: number; y: number } = { x: 0, y: 0 }
  private cameraPosition: { x: number; y: number } = { x: 0, y: 0 }
  private zoom = 1
  private minZoom = 0
  private maxZoom = 240
  private tiles: Map<string, THREE.Mesh> = new Map()
  private visibleTiles: Set<string> = new Set()
  private tileLimit = 0
  private adofaiFile: any
  private boundEventHandlers: Record<string, (event?: any) => void>
  private scene: THREE.Scene | null = null
  private camera: THREE.OrthographicCamera | null = null
  private renderer: THREE.WebGLRenderer | null = null
  private tileGeometry: THREE.BoxGeometry | null = null
  private tileMaterials: THREE.MeshBasicMaterial[] | null = null
  private initialPinchDistance = 0
  private initialZoom = 0
  private t: (key: string) => string

  private playbackState: PlaybackState = PlaybackState.HOLDING
  private planets: Planet[] = []
  private planetsCount = 2
  private currentBpm = 120
  private rotationSpeed = 0 // 弧度每毫秒
  private isClockwise = true
  private centerPlanetIndex = 0
  private gameStartTime = 0
  private currentTileIndex = 0
  private pauseButton: HTMLButtonElement | null = null
  private onPlaybackStateChange?: (state: PlaybackState) => void

  private particles: THREE.Points[] = []
  private particleGeometry: THREE.BufferGeometry | null = null
  private particleMaterial: THREE.PointsMaterial | null = null
  private planetTrails: Map<number, Array<{ position: THREE.Vector3; time: number }>> = new Map()

  constructor(
    adofaiFile: any,
    container: HTMLElement,
    fpsCounter: HTMLElement,
    info: HTMLElement,
    t: (key: string) => string,
    onPlaybackStateChange?: (state: PlaybackState) => void,
  ) {
    this.container = container
    this.fpsCounter = fpsCounter
    this.info = info
    this.adofaiFile = adofaiFile
    this.t = t
    this.onPlaybackStateChange = onPlaybackStateChange

    // 获取BPM
    this.currentBpm = this.adofaiFile?.settings?.bpm || 120
    this.updateRotationSpeed()

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
      contextMenu: (e: Event): void => e.preventDefault(),
      keyDown: this.onKeyDown.bind(this),
    }

    this.init()
    this.setupEventListeners()
    this.animate()
  }

  // 更新旋转速度
  private updateRotationSpeed(): void {
    // 1圈/120BPM = 2π弧度 / (60000ms/120) = 2π / 500ms
    this.rotationSpeed = (2 * Math.PI) / (60000 / this.currentBpm)
  }

  // 颜色计算函数
  private calculatePlanetColor(index: number, totalCount: number): THREE.Color {
    if (index === 0) return new THREE.Color(0xff0000) // 红色
    if (index === 1) return new THREE.Color(0x0000ff) // 蓝色


    const hue = ((index * 360) / totalCount) % 360
    const color = new THREE.Color()
    color.setHSL(hue / 360, 1, 0.5)
    return color
  }

  private calculatePolygonVertices(
    centerX: number,
    centerY: number,
    radius: number,
    count: number,
  ): Array<{ x: number; y: number }> {
    const vertices = []
    for (let i = 0; i < count; i++) {
      const angle = (i * 2 * Math.PI) / count
      vertices.push({
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      })
    }
    return vertices
  }

  private createPlanets(): void {
    this.clearPlanets()

    if (!this.scene || !this.adofaiFile?.tiles) {
      console.log("Scene or tiles not available")
      return
    }

    const tileKeys = Object.keys(this.adofaiFile.tiles)
    if (tileKeys.length < 2) {
      console.log("Not enough tiles:", tileKeys.length)
      return
    }

    const tile0 = this.adofaiFile.tiles[0]
    const tile1 = this.adofaiFile.tiles[1]
    if (!tile0 || !tile1) {
      console.log("Tiles not found:", { tile0, tile1 })
      return
    }

    const [x0, y0] = tile0.position
    const [x1, y1] = tile1.position

    console.log("Creating planets at positions:", { x0, y0, x1, y1 })

    // 创建更大的星球几何体
    const planetGeometry = new THREE.SphereGeometry(0.8, 32, 32) // 增大球体并提高细节

    for (let i = 0; i < this.planetsCount; i++) {
      const color = this.calculatePlanetColor(i, this.planetsCount)

      const material = new THREE.MeshLambertMaterial({
        color,
        transparent: false,
        opacity: 1.0,
      })

      const mesh = new THREE.Mesh(planetGeometry, material)

      if (i === 0) {
        mesh.position.set(x0, y0, 5)
      } else if (i === 1) {
        mesh.position.set(x1, y1, 5)
      } else {
        // 其他球暂时隐藏
        mesh.visible = false
        mesh.position.set(0, 0, 5)
      }

      // 确保球体可见
      mesh.visible = true
      mesh.castShadow = true
      mesh.receiveShadow = true

      const planet: Planet = {
        id: i,
        mesh,
        color,
        angle: i === 0 ? 0 : Math.PI,
        isCenter: i === 0,
        tileIndex: i,
      }

      this.planets.push(planet)
      this.scene.add(mesh)

      this.planetTrails.set(i, [])

      console.log(`Created planet ${i} at position:`, mesh.position, "Color:", color, "Visible:", mesh.visible)
    }

    this.initParticleSystem()

    console.log("Total planets created:", this.planets.length)
    console.log("Scene children count:", this.scene.children.length)
  }

  private initParticleSystem(): void {
    this.particleGeometry = new THREE.BufferGeometry()

    this.particleMaterial = new THREE.PointsMaterial({
      size: 0.05,
      transparent: true,
      opacity: 0.8,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
    })
  }

  private updateParticleTrails(deltaTime: number): void {
    if (this.playbackState !== PlaybackState.PLAYING) return

    const currentTime = performance.now()

    this.planets.forEach((planet) => {
      const trailArray = this.planetTrails.get(planet.id) || []

      // 添加当前位置到拖尾
      trailArray.push({
        position: planet.mesh.position.clone(),
        time: currentTime,
      })

      const filteredTrail = trailArray.filter((point) => currentTime - point.time < 500)
      this.planetTrails.set(planet.id, filteredTrail)

      this.createTrailParticles(planet, filteredTrail)
    })

    this.cleanupOldParticles()
  }

  private createTrailParticles(planet: Planet, trail: Array<{ position: THREE.Vector3; time: number }>): void {
    if (trail.length < 2 || !this.scene) return

    const positions: number[] = []
    const colors: number[] = []
    const currentTime = performance.now()

    trail.forEach((point, index) => {
      positions.push(point.position.x, point.position.y, point.position.z)

      const age = (currentTime - point.time) / 500 // 0-1
      const opacity = 1 - age

      colors.push(planet.color.r * opacity, planet.color.g * opacity, planet.color.b * opacity)
    })

    if (positions.length > 0) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))

      const material = new THREE.PointsMaterial({
        size: 0.1,
        transparent: true,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
      })

      const particles = new THREE.Points(geometry, material)
      particles.userData = { createdAt: currentTime, planetId: planet.id }

      this.scene.add(particles)
      this.particles.push(particles)
    }
  }

  private cleanupOldParticles(): void {
    const currentTime = performance.now()

    this.particles = this.particles.filter((particle) => {
      const age = currentTime - particle.userData.createdAt
      if (age > 500) {
        if (this.scene) {
          this.scene.remove(particle)
        }
        particle.geometry.dispose()
        if (particle.material instanceof THREE.Material) {
          particle.material.dispose()
        }
        return false
      }
      return true
    })
  }

  private updatePlanets(deltaTime: number): void {
    if (this.playbackState !== PlaybackState.PLAYING || this.planets.length === 0) return

    const centerPlanet = this.planets[this.centerPlanetIndex]
    if (!centerPlanet) return

    const centerPos = centerPlanet.mesh.position
    const rotationDelta = this.rotationSpeed * deltaTime * (this.isClockwise ? 1 : -1)

    this.planets.forEach((planet, index) => {
      if (index === this.centerPlanetIndex) return

      planet.angle += rotationDelta

      const radius = 3.0
      const x = centerPos.x + radius * Math.cos(planet.angle)
      const y = centerPos.y + radius * Math.sin(planet.angle)

      planet.mesh.position.set(x, y, 5)

      this.checkPlanetTileTransition(planet, index)
    })

    this.updateParticleTrails(deltaTime)
  }

  private checkPlanetTileTransition(planet: Planet, planetIndex: number): void {
    const nextTileIndex = this.centerPlanetIndex + 1
    const nextTile = this.adofaiFile.tiles[nextTileIndex]

    if (!nextTile) return

    const [tileX, tileY] = nextTile.position
    const planetPos = planet.mesh.position
    const distance = Math.sqrt(Math.pow(planetPos.x - tileX, 2) + Math.pow(planetPos.y - tileY, 2))

    if (distance < 0.5) {
      this.centerPlanetIndex = planetIndex
      this.currentTileIndex = nextTileIndex

      this.processActionsAtTile(nextTileIndex)

      this.recalculatePlanetAngles()
    }
  }

  private recalculatePlanetAngles(): void {
    const centerPlanet = this.planets[this.centerPlanetIndex]
    if (!centerPlanet) return

    this.planets.forEach((planet, index) => {
      if (index === this.centerPlanetIndex) return

      const dx = planet.mesh.position.x - centerPlanet.mesh.position.x
      const dy = planet.mesh.position.y - centerPlanet.mesh.position.y
      planet.angle = Math.atan2(dy, dx)
    })
  }

  private processActionsAtTile(tileIndex: number): void {
    const pauseActions = this.adofaiFile.getActionsByIndex?.("Pause", tileIndex)
    if (pauseActions?.count > 0) {
      const duration = pauseActions.actions[0]?.duration || 0
      const extraRotation = (duration / 2) * 2 * Math.PI
      this.planets.forEach((planet) => {
        if (planet.id !== this.centerPlanetIndex) {
          planet.angle += extraRotation * (this.isClockwise ? 1 : -1)
        }
      })
    }

    const speedActions = this.adofaiFile.getActionsByIndex?.("SetSpeed", tileIndex)
    if (speedActions?.count > 0) {
      const action = speedActions.actions[0]
      if (action.speedType === "Multiplier") {
        this.currentBpm *= action.bpmMultiplier || 1
      } else if (action.speedType === "Bpm") {
        this.currentBpm = action.beatsPerMinute || this.currentBpm
      }
      this.updateRotationSpeed()
    }

    const twirlActions = this.adofaiFile.getActionsByIndex?.("Twirl", tileIndex)
    if (twirlActions?.count > 0) {
      this.isClockwise = !this.isClockwise
    }
  }

  private createPauseButton(): void {
    if (this.pauseButton) return

    this.pauseButton = document.createElement("button")
    this.pauseButton.innerHTML = "⏸️"
    this.pauseButton.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 60px;
      height: 60px;
      background: rgba(128, 128, 128, 0.7);
      border: none;
      border-radius: 50%;
      font-size: 24px;
      cursor: pointer;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    `

    this.pauseButton.addEventListener("click", () => {
      this.setPlaybackState(PlaybackState.HOLDING)
    })

    document.body.appendChild(this.pauseButton)
  }

  private removePauseButton(): void {
    if (this.pauseButton) {
      document.body.removeChild(this.pauseButton)
      this.pauseButton = null
    }
  }

  public setPlaybackState(state: PlaybackState): void {
    if (this.playbackState === state) return

    const previousState = this.playbackState
    this.playbackState = state

    if (state === PlaybackState.PLAYING) {
      this.gameStartTime = performance.now()
      // 先移除所有星球
      this.clearPlanets()
      // 重新添加星球，确保每次播放都是全新状态
      this.createPlanets()
      this.createPauseButton()
      this.renderer?.setSize(window.innerWidth, window.innerHeight)
      this.updateCamera()
    } else {
      if (this.scene) {
        const testSphere = this.scene.children.find(
          (child) =>
            child instanceof THREE.Mesh &&
            child.material instanceof THREE.MeshBasicMaterial &&
            child.material.color.getHex() === 0xff0000,
        )
        if (testSphere) {
          this.scene.remove(testSphere)
        }
      }
      this.clearPlanets()
      this.removePauseButton()
      this.clearParticles()
      const containerSize = this.getContainerSize()
      this.renderer?.setSize(containerSize.width, containerSize.height)
      this.updateCamera()
      if (this.fpsCounter) {
        this.fpsCounter.style.display = "block"
      }
      if (this.info) {
        this.info.style.display = "block"
      }
      setTimeout(() => {
        this.updateFPS()
      }, 100)
    }
    this.onPlaybackStateChange?.(state)
  }

  private clearParticles(): void {
    this.particles.forEach((particle) => {
      if (this.scene) {
        this.scene.remove(particle)
      }
      particle.geometry.dispose()
      if (particle.material instanceof THREE.Material) {
        particle.material.dispose()
      }
    })
    this.particles = []
    this.planetTrails.clear()
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.code === "Space") {
      event.preventDefault()
      if (this.playbackState === PlaybackState.HOLDING) {
        this.setPlaybackState(PlaybackState.PLAYING)
      }
    } else if (event.code === "Escape") {
      event.preventDefault()
      if (this.playbackState === PlaybackState.PLAYING) {
        this.setPlaybackState(PlaybackState.HOLDING)
      }
    }
  }

  private getContainerSize(): { width: number; height: number } {
    if (this.playbackState === PlaybackState.PLAYING) {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
      }
    }

    const rect = this.container.getBoundingClientRect()
    return {
      width: rect.width,
      height: rect.height,
    }
  }

  public dispose(): void {
    console.log("Disposing Previewer...")
    this.isDisposed = true

    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }

    this.clearPlanets()
    this.removePauseButton()

    this.removeEventListeners()

    this.cleanupThreeJS()

    this.cleanupDOM()

    console.log("Previewer disposed successfully")
  }

  private removeEventListeners(): void {
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
    window.removeEventListener("keydown", this.boundEventHandlers.keyDown)
  }

  private cleanupThreeJS(): void {
    // 清理所有tile meshes
    this.tiles.forEach((mesh) => {
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat: any) => mat.dispose())
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
      this.tileMaterials.forEach((material: any) => {
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
        // 类型断言为 Mesh 来访问 geometry 和 material 属性
        const mesh = child as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((mat: any) => mat.dispose())
          } else {
            mesh.material.dispose()
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

  private cleanupDOM(): void {
    // 移除canvas元素
    if (this.container) {
      const canvas = this.container.querySelector("canvas")
      if (canvas) {
        this.container.removeChild(canvas)
      }
    }
  }

  private generateMockData(): any {
    return this.adofaiFile.tiles
  }

  private init(): void {
    // 获取容器尺寸
    const containerSize = this.getContainerSize()

    // 创建场景
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xf0f0f0) // 改为浅灰色背景

    // 创建摄像机 - 调整近远平面
    const aspect = containerSize.width / containerSize.height
    const frustumSize = 20
    this.camera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1, // 近平面
      100, // 远平面
    )
    this.camera.position.z = 10

    // 创建渲染器
    const RendererClass = THREE.WebGLRenderer
    this.renderer = new RendererClass({ antialias: true })
    this.renderer.setSize(containerSize.width, containerSize.height)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)

    // 添加更强的光源
    const ambientLight = new THREE.AmbientLight(0x404040, 1.0) // 增强环境光
    this.scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0) // 增强方向光
    directionalLight.position.set(10, 10, 15)
    directionalLight.castShadow = true
    this.scene.add(directionalLight)

    // 创建砖块几何体和材质
    this.tileGeometry = new THREE.BoxGeometry(1, 0.65, 0.2)
    this.tileMaterials = this.createTileMaterials()

    this.updateVisibleTiles()
  }

  private createTileMaterials(): THREE.MeshBasicMaterial[] {
    const materials: THREE.MeshBasicMaterial[] = []
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
      const m = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
      })
      m.color = new THREE.Color(color)
      m.opacity = 0.5
      materials.push(m)
    })

    return materials
  }

  private createTransparentTileWithMergedGeometry(meshData: any, opacity: number, color?: number): THREE.Mesh {
    const geometry = new THREE.BufferGeometry()
    geometry.setIndex(meshData.faces)
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(meshData.vertices, 3))
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(meshData.colors, 3))
    geometry.computeVertexNormals()

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: opacity,
      side: THREE.DoubleSide,
      depthWrite: false, // 禁用深度写入以避免排序问题
    })

    // 如果需要整体颜色调制
    if (color) {
      material.color = new THREE.Color(color)
    }

    return new THREE.Mesh(geometry, material)
  }

  private setupEventListeners(): void {
    // 使用绑定的事件处理函数
    this.renderer!.domElement.addEventListener("mousedown", this.boundEventHandlers.mouseDown)
    this.renderer!.domElement.addEventListener("mousemove", this.boundEventHandlers.mouseMove)
    this.renderer!.domElement.addEventListener("mouseup", this.boundEventHandlers.mouseUp)
    this.renderer!.domElement.addEventListener("wheel", this.boundEventHandlers.wheel)

    // 触摸事件（双指缩放）
    this.renderer!.domElement.addEventListener("touchstart", this.boundEventHandlers.touchStart)
    this.renderer!.domElement.addEventListener("touchmove", this.boundEventHandlers.touchMove)
    this.renderer!.domElement.addEventListener("touchend", this.boundEventHandlers.touchEnd)

    // 窗口大小调整
    window.addEventListener("resize", this.boundEventHandlers.windowResize)

    // 键盘事件
    window.addEventListener("keydown", this.boundEventHandlers.keyDown)

    // 防止右键菜单
    this.renderer!.domElement.addEventListener("contextmenu", this.boundEventHandlers.contextMenu)
  }

  private onMouseDown(event: MouseEvent): void {
    if (this.isDisposed || this.playbackState === PlaybackState.PLAYING) return
    this.isDragging = true
    this.previousMousePosition = {
      x: event.clientX,
      y: event.clientY,
    }
  }

  private onMouseMove(event: MouseEvent): void {
    if (this.isDisposed || !this.isDragging || this.playbackState === PlaybackState.PLAYING) return

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

  private onMouseUp(): void {
    if (this.isDisposed) return
    this.isDragging = false
  }

  private onWheel(event: WheelEvent): void {
    if (this.isDisposed || this.playbackState === PlaybackState.PLAYING) return
    event.preventDefault()

    const zoomSpeed = 0.1
    const zoomFactor = event.deltaY > 0 ? 1 - zoomSpeed : 1 + zoomSpeed

    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor))
    this.updateCamera()
  }

  // 触摸事件处理
  private onTouchStart(event: TouchEvent): void {
    if (this.isDisposed || this.playbackState === PlaybackState.PLAYING) return
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

  private onTouchMove(event: TouchEvent): void {
    if (this.isDisposed || this.playbackState === PlaybackState.PLAYING) return
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

  private onTouchEnd(): void {
    if (this.isDisposed) return
    this.isDragging = false
  }

  private getPinchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  private updateCamera(): void {
    if (this.isDisposed || !this.camera) return
    this.camera.position.x = this.cameraPosition.x
    this.camera.position.y = this.cameraPosition.y

    // 更新正交摄像机的视锥体 - 使用容器尺寸
    const containerSize = this.getContainerSize()
    const aspect = containerSize.width / containerSize.height
    const frustumSize = 20 / this.zoom

    this.camera.left = (frustumSize * aspect) / -2
    this.camera.right = (frustumSize * aspect) / 2
    this.camera.top = frustumSize / 2
    this.camera.bottom = frustumSize / -2
    this.camera.updateProjectionMatrix()

    if (this.playbackState === PlaybackState.HOLDING) {
      this.updateVisibleTiles()
    }
  }

  private updateVisibleTiles(): void {
    if (this.isDisposed || !this.scene || this.playbackState === PlaybackState.PLAYING) return
    // 计算摄像机能看到的范围 - 使用容器尺寸
    const containerSize = this.getContainerSize()
    const aspect = containerSize.width / containerSize.height
    const frustumSize = 20 / this.zoom

    const left = this.cameraPosition.x - (frustumSize * aspect) / 2
    const right = this.cameraPosition.x + (frustumSize * aspect) / 2
    const bottom = this.cameraPosition.y - frustumSize / 2
    const top = this.cameraPosition.y + frustumSize / 2

    // 清除当前可见的砖块
    this.visibleTiles.forEach((tileId) => {
      if (this.tiles.has(tileId)) {
        this.scene!.remove(this.tiles.get(tileId)!)
      }
    })
    this.visibleTiles.clear()

    // 找到在视野范围内的砖块
    let visibleTileIds: string[] = []
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
          const tile = this.adofaiFile.tiles[Number.parseInt(id) - 1]
          const [x, y] = tile?.position || [0, 0]
          const distance = Math.sqrt(Math.pow(x - this.cameraPosition.x, 2) + Math.pow(y - this.cameraPosition.y, 2))
          return { id, distance }
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, this.tileLimit)
        .map((item) => item.id)
    }

    // 创建或重用砖块mesh
    tilesToRender.forEach((id, index) => {
      const tile = this.adofaiFile.tiles[Number.parseInt(id) - 1]
      const [x, y] = tile?.position || [0, 0]

      let tileMesh
      if (this.tiles.has(id)) {
        tileMesh = this.tiles.get(id)!
      } else {
        // 计算层级（第一个砖块层级12，后续递减）
        const zLevel = 12 - Number.parseInt(id)
        const materialIndex = Number.parseInt(id) % this.tileMaterials!.length

        let pred = (this.adofaiFile.tiles[Number.parseInt(id) - 1]?.direction || 0) - 180
        if (this.adofaiFile.tiles[Number.parseInt(id) - 1]?.direction == 999) {
          pred = this.adofaiFile.tiles[Number.parseInt(id) - 2]?.direction || 0
          //pred -= 180;
        }
        const pred2 = this.adofaiFile.tiles[Number.parseInt(id)]?.direction || 0

        const meshdata = createTrackMesh(pred, pred2, this.adofaiFile.tiles[Number.parseInt(id)]?.direction == 999);
        if (!meshdata || !meshdata.faces) {
          console.error("Meshdata or meshdata.faces is undefined for tile id:", id, meshdata);
          return;
        }
        const mesh = new THREE.BufferGeometry();
        mesh.setIndex(meshdata.faces);
        mesh.setAttribute("position", new THREE.Float32BufferAttribute(meshdata.vertices, 3));
        mesh.setAttribute("color", new THREE.Float32BufferAttribute(meshdata.colors, 3));
        mesh.computeVertexNormals();

        tileMesh = new THREE.Mesh(mesh, this.tileMaterials![materialIndex])
        tileMesh.position.set(x, y, zLevel * 0.01) // 微小的z差异来实现层级
        tileMesh.castShadow = true
        tileMesh.receiveShadow = true

        this.tiles.set(id, tileMesh)
      }

      this.scene!.add(tileMesh)
      this.visibleTiles.add(id)
    })
  }

  private updateFPS(): void {
    if (this.isDisposed) return
    this.frameCount++
    const currentTime = performance.now()

    // 每0.5秒更新一次FPS显示
    if (currentTime - this.lastTime >= 500) {
      this.fps = (this.frameCount * 1000) / (currentTime - this.lastTime)
      if (this.fpsCounter && this.playbackState === PlaybackState.HOLDING) {
        this.fpsCounter.textContent = `FPS  ${this.fps.toFixed(2)}`
      }

      // 更新信息显示
      if (this.info && this.playbackState === PlaybackState.HOLDING) {
        this.info.innerHTML = `
                    <div>${this.t("editor.info.cameraPosition")} (${this.cameraPosition.x.toFixed(2)}, ${this.cameraPosition.y.toFixed(2)})</div>
                    <div>${this.t("editor.info.zoom")} ${this.zoom.toFixed(2)}</div>
                    <div>${this.t("editor.info.horizon")} ${this.visibleTiles.size}</div>
                    <div>${this.t("editor.info.total")} ${Object.keys(this.adofaiFile.tiles).length}</div>
                `
      }

      this.frameCount = 0
      this.lastTime = currentTime
    }
  }

  public onWindowResize(): void {
    if (this.isDisposed || !this.camera || !this.renderer) return
    // 使用容器尺寸而不是窗口尺寸
    const containerSize = this.getContainerSize()
    const aspect = containerSize.width / containerSize.height
    const frustumSize = 20 / this.zoom

    this.camera.left = (frustumSize * aspect) / -2
    this.camera.right = (frustumSize * aspect) / 2
    this.camera.top = frustumSize / 2
    this.camera.bottom = frustumSize / -2
    this.camera.updateProjectionMatrix()

    this.renderer.setSize(containerSize.width, containerSize.height)

    if (this.playbackState === PlaybackState.HOLDING) {
      this.updateVisibleTiles()
    }
  }

  // 替换 animate 方法：
  private animate(): void {
    if (this.isDisposed) return

    this.animationId = requestAnimationFrame(this.animate.bind(this))

    const currentTime = performance.now()
    const deltaTime = currentTime - this.lastTime

    // 更新星球位置
    if (this.playbackState === PlaybackState.PLAYING) {
      this.updatePlanets(deltaTime)
    }

    this.updateFPS()

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera)
    }

    // 更新lastTime用于下一帧
    this.lastTime = currentTime
  }

  // 替换 clearPlanets 方法：
  private clearPlanets(): void {
    this.planets.forEach((planet) => {
      if (this.scene) {
        this.scene.remove(planet.mesh)
      }
      planet.mesh.geometry.dispose()
      if (planet.mesh.material instanceof THREE.Material) {
        planet.mesh.material.dispose()
      }
    })
    this.planets = []
    this.clearParticles()
  }
}

// 主编辑器页面
export default function EditorPage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const fpsCounterRef = useRef<HTMLDivElement>(null)
  const infoRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewerRef = useRef<Previewer | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [adofaiFile, setAdofaiFile] = useState<any>(null)
  const [mounted, setMounted] = useState(false)
  const [themeReady, setThemeReady] = useState(false)
  const [playbackState, setPlaybackState] = useState<PlaybackState>(PlaybackState.HOLDING)
  const { theme, resolvedTheme } = useTheme()
  const { t, mounted: i18nMounted } = useI18n()

  // 确保组件和主题都已挂载
  useEffect(() => {
    setMounted(true)
    // 延迟一点时间确保主题完全加载
    const timer = setTimeout(() => {
      setThemeReady(true)
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // 监听主题变化，确保主题正确应用
  useEffect(() => {
    if (mounted && resolvedTheme) {
      // 强制重新渲染以确保主题正确应用
      setThemeReady(false)
      const timer = setTimeout(() => {
        setThemeReady(true)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [mounted, resolvedTheme])

  // 播放状态变化回调
  const handlePlaybackStateChange = useCallback((state: PlaybackState) => {
    setPlaybackState(state)
  }, [])

  // 播放/暂停切换
  const togglePlayback = useCallback(() => {
    if (previewerRef.current) {
      const newState = playbackState === PlaybackState.HOLDING ? PlaybackState.PLAYING : PlaybackState.HOLDING
      previewerRef.current.setPlaybackState(newState)
    }
  }, [playbackState])

  // 导出文件功能
  const handleExport = useCallback((): void => {
    if (!adofaiFile) {
      window.showNotification?.("error", t("editor.notifications.noFileToExport"))
      return
    }

    try {
      const exportData = adofaiFile.export("string")
      const blob = new Blob([exportData], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "level.adofai"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      window.showNotification?.("success", t("editor.notifications.exportSuccess"))
    } catch (error) {
      console.error("Export error:", error)
      window.showNotification?.("error", t("editor.notifications.exportError"))
    }
  }, [adofaiFile, t])

  // 文件加载处理
  const handleFileLoad = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0]
      if (!file) return

      setIsLoading(true)
      const reader = new FileReader()

      reader.onload = async (e): Promise<void> => {
        try {
          const content = e.target?.result as string

          // 使用ADOFAI.js解析文件
          const level = new ADOFAI.Level(content, Hjson)

          level.on("load", (loadedLevel: any): void => {
            loadedLevel.calculateTileCoordinates()
            setAdofaiFile(loadedLevel)

            // 关键修改：在创建新的Previewer之前，先清理旧的
            if (previewerRef.current) {
              console.log("Disposing old Previewer...")
              previewerRef.current.dispose()
              previewerRef.current = null
            }

            // 创建新的Previewer
            if (containerRef.current && fpsCounterRef.current && infoRef.current) {
              previewerRef.current = new Previewer(
                loadedLevel,
                containerRef.current,
                fpsCounterRef.current,
                infoRef.current,
                t,
                handlePlaybackStateChange,
              )
            }
            window.showNotification?.("success", t("editor.notifications.loadSuccess"))
          })

          await level.load()
        } catch (error) {
          window.showNotification?.("error", t("editor.notifications.loadError"))
          console.error(error)
        } finally {
          setIsLoading(false)
        }
      }

      reader.onerror = (): void => {
        window.showNotification?.("error", t("editor.notifications.fileReadError"))
        setIsLoading(false)
      }

      reader.readAsText(file)
    },
    [t, handlePlaybackStateChange],
  )

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault()
        fileInputRef.current?.click()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // 初始化示例数据
  useEffect(() => {
    if (!mounted || !i18nMounted || !themeReady) return

    const initializeExample = async (): Promise<void> => {
      try {
        const level = new ADOFAI.Level(example, Hjson)
        level.on("load", (loadedLevel: any): void => {
          loadedLevel.calculateTileCoordinates()
          setAdofaiFile(loadedLevel)

          if (previewerRef.current) {
            console.log("Disposing old Previewer...")
            previewerRef.current.dispose()
            previewerRef.current = null
          }

          if (containerRef.current && fpsCounterRef.current && infoRef.current) {
            previewerRef.current = new Previewer(
              loadedLevel,
              containerRef.current,
              fpsCounterRef.current,
              infoRef.current,
              t,
              handlePlaybackStateChange,
            )
          }
          window.showNotification?.("success", t("editor.notifications.loadSuccess"))
        })

        await level.load()
      } catch (error) {
        window.showNotification?.("error", t("editor.notifications.loadError"))
        console.error(error)
      }
    }

    initializeExample()
  }, [mounted, i18nMounted, themeReady, t, handlePlaybackStateChange])

  // 监听窗口大小变化，触发Previewer的resize
  useEffect(() => {
    const handleResize = (): void => {
      if (previewerRef.current) {
        // 延迟执行以确保容器尺寸已更新
        setTimeout(() => {
          previewerRef.current?.onWindowResize()
        }, 100)
      }
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  // 页面卸载时清理资源
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      if (previewerRef.current) {
        previewerRef.current.dispose()
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      if (previewerRef.current) {
        previewerRef.current.dispose()
      }
    }
  }, [])

  // 如果还没有完全挂载，显示加载状态
  if (!mounted || !i18nMounted || !themeReady) {
    return (
      <div className="h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-slate-600 dark:text-slate-400">{t("common.loading")}</div>
      </div>
    )
  }

  // 使用 resolvedTheme 来确保获取到正确的主题值
  const currentTheme = resolvedTheme || theme
  const isDark = currentTheme === "dark"

  return (
    <div className={`h-screen ${isDark ? "bg-slate-900" : "bg-slate-50"} flex flex-col overflow-hidden`}>
      <NotificationSystem />

      {/* Header - 只在 holding 状态显示 */}
      {playbackState === PlaybackState.HOLDING && (
        <header
          className={`${
            isDark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"
          } border-b px-4 py-3 flex justify-between items-center flex-shrink-0`}
        >
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button
                variant="ghost"
                size="sm"
                className={`${
                  isDark
                    ? "text-slate-300 hover:text-white hover:bg-slate-700"
                    : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                <Home className="w-4 h-4 mr-2" />
                {t("common.home")}
              </Button>
            </Link>
            <h1 className={`text-lg font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>{t("editor.title")}</h1>
          </div>

          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".adofai,.json" onChange={handleFileLoad} className="hidden" />
            <Button
              variant="ghost"
              size="sm"
              className={`${
                isDark
                  ? "text-slate-300 hover:text-white hover:bg-slate-700"
                  : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
              }`}
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              id="butload"
            >
              <Upload className="w-4 h-4 mr-2" />
              {isLoading ? t("common.loading") : t("editor.loadFile")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`${
                isDark
                  ? "text-slate-300 hover:text-white hover:bg-slate-700"
                  : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
              }`}
              onClick={handleExport}
              disabled={!adofaiFile}
            >
              <Download className="w-4 h-4 mr-2" />
              {t("editor.export")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`${
                isDark
                  ? "text-slate-300 hover:text-white hover:bg-slate-700"
                  : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <Save className="w-4 h-4 mr-2" />
              {t("editor.save")}
            </Button>
            <Link to="/settings">
              <Button
                variant="ghost"
                size="sm"
                className={`${
                  isDark
                    ? "text-slate-300 hover:text-white hover:bg-slate-700"
                    : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                <Settings className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </header>
      )}

      {/* Main Editor Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - 只在 holding 状态显示 */}
        {playbackState === PlaybackState.HOLDING && (
          <aside
            className={`w-64 ${
              isDark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"
            } border-r p-4 flex-shrink-0 overflow-y-auto`}
          >
            <div className="space-y-4">
              <div>
                <h3 className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-slate-700"} mb-2`}>
                  {t("editor.levelInfo")}
                </h3>
                <div className={`space-y-1 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  <div>
                    {t("editor.tiles")}:{" "}
                    {adofaiFile?.tiles ? Object.keys(adofaiFile.tiles).length : t("common.loading")}
                  </div>
                  <div>
                    {t("editor.bpm")}: {adofaiFile?.settings?.bpm || "unknown"}
                  </div>
                  <div>
                    {t("editor.offset")}: {adofaiFile?.settings?.offset || 0}ms
                  </div>
                </div>
              </div>

              <div>
                <h3 className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-slate-700"} mb-2`}>
                  {t("editor.tools")}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className={`${
                      isDark
                        ? "border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    } bg-transparent`}
                  >
                    {t("editor.select")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`${
                      isDark
                        ? "border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    } bg-transparent`}
                  >
                    {t("editor.move")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`${
                      isDark
                        ? "border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    } bg-transparent`}
                  >
                    {t("editor.addTile")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`${
                      isDark
                        ? "border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    } bg-transparent`}
                  >
                    {t("editor.removeTile")}
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        )}

        {/* Main Canvas Area */}
        <div ref={containerRef} className="flex-1 relative">
          <div
            ref={fpsCounterRef}
            className="absolute top-4 left-4 text-sm font-medium text-white bg-black bg-opacity-50 px-2 py-1 rounded"
          >
            FPS 0.00
          </div>
          <div
            ref={infoRef}
            className="absolute top-4 right-4 text-sm font-medium text-white bg-black bg-opacity-50 px-2 py-1 rounded"
          >
            {/* Info will be updated dynamically */}
          </div>
        </div>
      </div>
    </div>
  )
}
