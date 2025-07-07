"use client"

import type React from "react"
import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Home, Settings, Save, Upload, Download, RotateCcw, Play, Pause } from "lucide-react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { useI18n } from "@/lib/i18n/context"
import * as THREE from "three"
import * as ADOFAI from "@/lib/ADOFAI/index.js"
import Hjson from "hjson"
import createTrackMesh from "@/lib/Geo/mesh_reserve.js"
import example from "@/lib/example/line.json"
import { version } from "@/control/VersionManager"
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

// Previewer类接口定义
interface PreviewerOptions {
  adofaiFile: any
  container: HTMLElement
  fpsCounter: HTMLElement
  info: HTMLElement
}

// Previewer类 - 修改canvas大小逻辑
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

  constructor(
    adofaiFile: any,
    container: HTMLElement,
    fpsCounter: HTMLElement,
    info: HTMLElement,
    t: (key: string) => string,
  ) {
    this.container = container
    this.fpsCounter = fpsCounter
    this.info = info
    this.adofaiFile = adofaiFile
    this.t = t

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
    }

    this.init()
    this.setupEventListeners()
    this.animate()
  }

  // 获取容器尺寸
  private getContainerSize(): { width: number; height: number } {
    const rect = this.container.getBoundingClientRect()
    return {
      width: rect.width,
      height: rect.height,
    }
  }

  // 添加清理方法
  public dispose(): void {
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
    this.scene.background = new THREE.Color(0xf9f9f9)

    // 创建摄像机 (正交摄像机更适合2D) - 使用容器尺寸
    const aspect = containerSize.width / containerSize.height
    const frustumSize = 20
    this.camera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      1,
      1000,
    )
    this.camera.position.z = 10

    // 创建渲染器 - 使用容器尺寸
    let RendererClass
    if (false && navigator.gpu) {
      // RendererClass = WebGPURenderer
      RendererClass = THREE.WebGLRenderer
    } else {
      RendererClass = THREE.WebGLRenderer
    }
    this.renderer = new RendererClass({ antialias: true })
    this.renderer.setSize(containerSize.width, containerSize.height)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)

    // 添加光源
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6)
    this.scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 10, 5)
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

    // 防止右键菜单
    this.renderer!.domElement.addEventListener("contextmenu", this.boundEventHandlers.contextMenu)
  }

  private onMouseDown(event: MouseEvent): void {
    if (this.isDisposed) return
    this.isDragging = true
    this.previousMousePosition = {
      x: event.clientX,
      y: event.clientY,
    }
  }

  private onMouseMove(event: MouseEvent): void {
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

  private onMouseUp(): void {
    if (this.isDisposed) return
    this.isDragging = false
  }

  private onWheel(event: WheelEvent): void {
    if (this.isDisposed) return
    event.preventDefault()

    const zoomSpeed = 0.1
    const zoomFactor = event.deltaY > 0 ? 1 - zoomSpeed : 1 + zoomSpeed

    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor))
    this.updateCamera()
  }

  // 触摸事件处理
  private onTouchStart(event: TouchEvent): void {
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

  private onTouchMove(event: TouchEvent): void {
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

    this.updateVisibleTiles()
  }

  private updateVisibleTiles(): void {
    if (this.isDisposed || !this.scene) return
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

        const meshdata = createTrackMesh(pred, pred2, this.adofaiFile.tiles[Number.parseInt(id)]?.direction == 999)

        const mesh = new THREE.BufferGeometry()

        mesh.setIndex(meshdata.faces)
        mesh.setAttribute("position", new THREE.Float32BufferAttribute(meshdata.vertices, 3))
        mesh.setAttribute("color", new THREE.Float32BufferAttribute(meshdata.colors, 3))
        mesh.computeVertexNormals()

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
      if (this.fpsCounter) {
        this.fpsCounter.textContent = `FPS  ${this.fps.toFixed(2)}`
      }

      // 更新信息显示
      if (this.info) {
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
    this.updateVisibleTiles()
  }

  private animate(): void {
    if (this.isDisposed) return

    this.animationId = requestAnimationFrame(this.animate.bind(this))
    this.updateFPS()
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera)
    }
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
    [t],
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
  }, [mounted, i18nMounted, themeReady, t])

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

      {/* Header */}
      <header
        className={`${
          isDark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"
        } border-b px-4 py-3 flex justify-between items-center flex-shrink-0`}
      >
        <div className="flex items-center gap-4">
          <Link href="/">
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
          <Link href="/settings">
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

      {/* Main Editor Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
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
                  {t("editor.tiles")}: {adofaiFile?.tiles ? Object.keys(adofaiFile.tiles).length : t("common.loading")}
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
                  } bg-transparent flex-1`}
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div>
              <h3 className={`text-sm font-medium ${isDark ? "text-slate-300" : "text-slate-700"} mb-2`}>
                {t("editor.playback")}
              </h3>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className={`${
                    isDark
                      ? "border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                      : "border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  } bg-transparent flex-1`}
                >
                  <Play className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={`${
                    isDark
                      ? "border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                      : "border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  } bg-transparent flex-1`}
                >
                  <Pause className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </aside>

        {/* 3D Viewport */}
        <main className="flex-1 relative overflow-hidden">
          <div ref={containerRef} id="container" className="w-full h-full" />

          {/* FPS Counter */}
          <div
            ref={fpsCounterRef}
            id="fps-counter"
            className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg p-3 text-white text-sm"
          >
            FPS: 0.00
          </div>

          {/* Info Panel */}
          <div
            ref={infoRef}
            id="info"
            className="absolute bottom-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg p-3 text-white text-sm space-y-1"
          >
            <div>{t("editor.info.cameraPosition")} (0.00, 0.00)</div>
            <div>{t("editor.info.zoom")} 1.00</div>
            <div>{t("editor.info.horizon")} 0</div>
            <div>{t("editor.info.total")} 0</div>
          </div>

          {/* Controls Help */}
          <div className="absolute bottom-4 right-4 bg-black/50 backdrop-blur-sm rounded-lg p-2 text-white text-xs">
            <div>{t("editor.controls.pan")}</div>
            <div>{t("editor.controls.zoom")}</div>
            <div>{t("editor.controls.openFile")}</div>
          </div>
        </main>
      </div>

      {/* Status Bar */}
      <footer
        className={`${
          isDark ? "bg-slate-800 border-slate-700 text-slate-400" : "bg-white border-slate-200 text-slate-600"
        } border-t px-4 py-2 text-sm flex-shrink-0`}
      >
        <div className="flex justify-between items-center">
          <div>
            Re_ADOJAS {t("home.version")} {version.tag}
          </div>
          <div>{t("editor.status.insider")}</div>
        </div>
      </footer>
    </div>
  )
}
