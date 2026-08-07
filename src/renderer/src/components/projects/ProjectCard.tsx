import { useRef, type DragEvent, type MouseEvent, type ReactElement } from 'react'
import { Avatar, Button, Card, Dropdown, Space, Tag, Typography } from 'antd'
import { DeleteOutlined, EditOutlined, FolderOutlined, MoreOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { Project } from '@/models'
import { avatarColor } from '@/utils/avatar-color'
import { formatDate } from '@/utils/format'

interface ProjectCardProps {
  project: Project
  onEdit: () => void
  onDelete: () => void
  /** 拖动排序：卡片是否可拖拽。 */
  draggable?: boolean
  /** 当前正在被拖动的卡片。 */
  dragging?: boolean
  /** 当前拖动的落点卡片。 */
  dropTarget?: boolean
  onDragStart?: (event: DragEvent<HTMLElement>) => void
  onDragEnter?: () => void
  onDragOver?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
  onDrop?: (event: DragEvent<HTMLElement>) => void
}

/** 项目卡片：点击进入对话，右上角菜单可编辑或删除。 */
export function ProjectCard({
  project,
  onEdit,
  onDelete,
  draggable = false,
  dragging = false,
  dropTarget = false,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDragEnd,
  onDrop
}: ProjectCardProps): ReactElement {
  const navigate = useNavigate()
  // 拖拽结束紧接着触发的 click 不应跳转（真实拖拽后 Chrome 通常会吞掉 click，这里兜底）。
  const suppressClick = useRef(false)

  const handleOpen = (event: MouseEvent<HTMLElement>): void => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    // 点击删除按钮或 Popconfirm 弹层时不触发卡片跳转
    const target = event.target as HTMLElement
    if (target.closest('button, a, .ant-popconfirm')) return
    void navigate(`/projects/${project.id}`)
  }

  const handleDragEnd = (): void => {
    onDragEnd?.()
    suppressClick.current = true
    setTimeout(() => {
      suppressClick.current = false
    }, 0)
  }

  const cardClass = ['project-card', dragging && 'project-card-dragging', dropTarget && 'project-card-drop-target']
    .filter(Boolean)
    .join(' ')

  return (
    <Card
      hoverable
      className={cardClass}
      draggable={draggable}
      onClick={handleOpen}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragEnd={handleDragEnd}
      onDrop={onDrop}
    >
      <div className="project-card-top">
        <div className="project-card-identity">
          <Avatar className="project-card-avatar" size={40} shape="square" style={{ background: avatarColor(project.name), flexShrink: 0 }}>
            {project.name.charAt(0).toUpperCase()}
          </Avatar>
          <div style={{ minWidth: 0 }}>
            <Typography.Text className="project-card-title" ellipsis>
              {project.name}
            </Typography.Text>
            <Typography.Text className="project-card-date">
              {formatDate(project.updatedAt)}
            </Typography.Text>
          </div>
        </div>
        <Dropdown
          menu={{
            items: [
              { key: 'edit', icon: <EditOutlined />, label: '编辑项目' },
              { type: 'divider' },
              { key: 'delete', icon: <DeleteOutlined />, label: '删除项目', danger: true }
            ],
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation()
              if (key === 'edit') onEdit()
              if (key === 'delete') onDelete()
            }
          }}
          trigger={['click']}
        >
          <Button className="project-card-more" type="text" size="small" icon={<MoreOutlined />} aria-label="项目操作" onClick={(event) => event.stopPropagation()} />
        </Dropdown>
      </div>

      <Typography.Paragraph className="project-card-description" ellipsis={{ rows: 2 }}>
        {project.description || '暂无描述'}
      </Typography.Paragraph>

      <div className="project-card-meta">
      {project.tags.length > 0 && (
        <Space size={[4, 4]} wrap>
          {project.tags.map((tag) => (
            <Tag className="project-tag" key={tag}>{tag}</Tag>
          ))}
        </Space>
      )}

      {project.path && (
        <Typography.Text className="project-card-path" style={{ display: 'block', marginTop: 12 }} ellipsis>
          <FolderOutlined style={{ marginRight: 6 }} />
          {project.path}
        </Typography.Text>
      )}
      </div>
    </Card>
  )
}
