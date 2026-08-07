import { useMemo, useState, type DragEvent, type ReactElement } from 'react'
import { App, Button, Col, Empty, Input, Row, Skeleton, Space, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { CreateProjectModal } from '@/components/projects/CreateProjectModal'
import { ProjectCard } from '@/components/projects/ProjectCard'
import type { CreateProjectInput, Project, UpdateProjectInput } from '@/models'
import { useProjects } from '@/state/ProjectsContext'

/** 项目列表页：搜索（名称）、新建、删除、拖动排序。 */
export function ProjectsPage(): ReactElement {
  const { projects, loading, createProject, updateProject, deleteProject, reorderProjects, searchProjects } = useProjects()
  const { modal } = App.useApp()
  const [keyword, setKeyword] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project>()
  // 拖动排序：dragId 为被拖卡片，overId 为当前悬停落点，pendingOrder 为拖拽中的实时顺序。
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)

  // 搜索时不做拖拽排序，避免只对子集重排。
  const searching = keyword.trim().length > 0

  const filtered = useMemo(() => searchProjects(keyword), [searchProjects, keyword])

  // 拖拽过程中用 pendingOrder 覆盖展示顺序；否则使用搜索结果顺序。
  // 搜索时始终忽略 pendingOrder，避免拖拽被中断（如 ESC）后残留的顺序影响筛选视图。
  const displayList = useMemo(() => {
    if (searching || !pendingOrder) return filtered
    const byId = new Map(filtered.map((project) => [project.id, project]))
    return pendingOrder
      .map((id) => byId.get(id))
      .filter((project): project is Project => project !== undefined)
  }, [filtered, pendingOrder, searching])

  const handleDragStart = (id: string) => (event: DragEvent<HTMLElement>): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    setDragId(id)
    setOverId(id)
    setPendingOrder(projects.map((project) => project.id))
  }

  const handleDragEnter = (id: string): void => {
    if (!dragId || !pendingOrder || dragId === id || overId === id) return
    setOverId(id)
    setPendingOrder((current) => {
      if (!current) return current
      const next = current.filter((item) => item !== dragId)
      const to = next.indexOf(id)
      if (to === -1) return current
      next.splice(to, 0, dragId)
      return next
    })
  }

  /** 拖拽结束/放下：顺序有变化才落盘，然后清空拖拽状态。 */
  const commitReorder = (): void => {
    if (!pendingOrder) return
    const currentOrder = projects.map((project) => project.id)
    const changed = currentOrder.length !== pendingOrder.length || currentOrder.some((id, index) => id !== pendingOrder[index])
    if (changed) {
      void reorderProjects(pendingOrder)
    }
    setDragId(null)
    setOverId(null)
    setPendingOrder(null)
  }

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    commitReorder()
  }

  const handleDragEnd = (): void => {
    commitReorder()
  }

  const handleCreate = async (input: CreateProjectInput): Promise<void> => {
    await createProject(input)
  }

  const handleUpdate = async (id: string, input: UpdateProjectInput): Promise<void> => {
    await updateProject(id, input)
  }

  const handleDelete = (project: Project): void => {
    modal.confirm({
      title: '删除项目',
      content: `确定删除「${project.name}」吗？此操作无法恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => deleteProject(project.id)
    })
  }

  const openCreateModal = (): void => {
    setEditingProject(undefined)
    setModalOpen(true)
  }

  const openEditModal = (project: Project): void => {
    setEditingProject(project)
    setModalOpen(true)
  }

  const closeModal = (): void => {
    setModalOpen(false)
    setEditingProject(undefined)
  }

  return (
    <div className="page-frame p-12">
      <div className="page-header">
        <div>
          <Typography.Title level={2} className="page-title">项目</Typography.Title>
          <Typography.Text className="page-subtitle">{projects.length > 0 ? `共 ${projects.length} 个项目，可从任意项目继续协作。` : '创建一个项目，开始与 Koala 协作。'}</Typography.Text>
        </div>
        <Space className="page-actions">
          <Input.Search
            allowClear
            placeholder="搜索项目名称"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            style={{ width: 240 }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            新建项目
          </Button>
        </Space>
      </div>

      {loading ? (
        <Row className="project-grid" gutter={[16, 16]}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Col key={index} xs={24} sm={12} lg={8} xl={6}>
              <Skeleton active paragraph={{ rows: 4 }} />
            </Col>
          ))}
        </Row>
      ) : displayList.length > 0 ? (
        <Row
          className="project-grid"
          gutter={[16, 16]}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {displayList.map((project) => (
            <Col key={project.id} xs={24} sm={12} lg={8} xl={6}>
              <ProjectCard
                project={project}
                onEdit={() => openEditModal(project)}
                onDelete={() => handleDelete(project)}
                draggable={!searching}
                dragging={dragId === project.id}
                dropTarget={dragId !== null && dragId !== project.id && overId === project.id}
                onDragStart={handleDragStart(project.id)}
                onDragEnter={() => handleDragEnter(project.id)}
                onDragOver={(event) => event.preventDefault()}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
              />
            </Col>
          ))}
        </Row>
      ) : (
        <Empty
          className="empty-state"
          description={
            projects.length === 0
              ? '还没有项目，点击右上角「新建项目」创建第一个项目。'
              : `未找到名称包含「${keyword.trim()}」的项目`
          }
        />
      )}

      <CreateProjectModal open={modalOpen} project={editingProject} onClose={closeModal} onCreate={handleCreate} onUpdate={handleUpdate} />
    </div>
  )
}
