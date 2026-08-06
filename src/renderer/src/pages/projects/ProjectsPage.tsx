import { useMemo, useState, type ReactElement } from 'react'
import { App, Button, Col, Empty, Input, Row, Skeleton, Space, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { CreateProjectModal } from '@/components/projects/CreateProjectModal'
import { ProjectCard } from '@/components/projects/ProjectCard'
import type { CreateProjectInput, Project, UpdateProjectInput } from '@/models'
import { useProjects } from '@/state/ProjectsContext'

/** 项目列表页：搜索（名称）、新建、删除。 */
export function ProjectsPage(): ReactElement {
  const { projects, loading, createProject, updateProject, deleteProject, searchProjects } = useProjects()
  const { modal } = App.useApp()
  const [keyword, setKeyword] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project>()

  const filtered = useMemo(() => searchProjects(keyword), [searchProjects, keyword])

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
      ) : filtered.length > 0 ? (
        <Row className="project-grid" gutter={[16, 16]}>
          {filtered.map((project) => (
            <Col key={project.id} xs={24} sm={12} lg={8} xl={6}>
              <ProjectCard project={project} onEdit={() => openEditModal(project)} onDelete={() => handleDelete(project)} />
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
