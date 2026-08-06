import { useEffect, useState, type ReactElement } from 'react'
import { App, Button, Form, Input, Modal, Select, Space } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { projectsApi } from '@/services/projects'
import type { CreateProjectInput, Project, UpdateProjectInput } from '@/models'

interface CreateProjectModalProps {
  open: boolean
  onClose: () => void
  onCreate: (input: CreateProjectInput) => Promise<void>
  onUpdate: (id: string, input: UpdateProjectInput) => Promise<void>
  project?: Project
}

interface FormValues {
  name: string
  description?: string
  tags?: string[]
}

/** 新建项目弹窗：名称、描述、标签；文件夹支持新建或选择已有目录。 */
export function CreateProjectModal({ open, onClose, onCreate, onUpdate, project }: CreateProjectModalProps): ReactElement {
  const [form] = Form.useForm<FormValues>()
  const { message } = App.useApp()
  const [submitting, setSubmitting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [path, setPath] = useState('')

  useEffect(() => {
    if (open) {
      form.resetFields()
      form.setFieldsValue({
        name: project?.name ?? '',
        description: project?.description ?? '',
        tags: project?.tags ?? []
      })
      setPath(project?.path ?? '')
    }
  }, [open, form, project])

  const handlePickDirectory = async (): Promise<void> => {
    setPicking(true)
    try {
      const dir = await projectsApi.pickDirectory()
      if (dir) setPath(dir)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '选择文件夹失败')
    } finally {
      setPicking(false)
    }
  }

  const handleOk = async (): Promise<void> => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      const input = {
        name: values.name.trim(),
        description: values.description?.trim() ?? '',
        tags: values.tags ?? [],
        path: path.trim() || undefined
      }
      if (project) {
        await onUpdate(project.id, input)
        message.success('项目已更新')
      } else {
        await onCreate(input)
        message.success('项目已创建')
      }
      onClose()
    } catch (error) {
      message.error(error instanceof Error ? error.message : project ? '更新项目失败' : '创建项目失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={project ? '编辑项目' : '新建项目'}
      open={open}
      onOk={() => void handleOk()}
      onCancel={onClose}
      confirmLoading={submitting}
      okText={project ? '保存' : '创建'}
      cancelText="取消"
      width={520}
    >
      <Form form={form} layout="vertical" name="create-project" style={{ marginTop: 16 }}>
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, whitespace: true, message: '请输入项目名称' },
            { max: 60, message: '名称不能超过 60 个字符' }
          ]}
        >
          <Input placeholder="项目名称" maxLength={60} />
        </Form.Item>

        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="项目描述（可选）" maxLength={200} showCount />
        </Form.Item>

        <Form.Item name="tags" label="标签">
          <Select
            mode="tags"
            placeholder="输入后回车添加标签"
            tokenSeparators={[',', '，', ' ']}
            open={false}
            suffixIcon={null}
            maxCount={10}
          />
        </Form.Item>

        <Form.Item label="文件夹" htmlFor="project-path">
          <Space.Compact style={{ width: '100%' }}>
            <Input
              id="project-path"
              placeholder="选择或新建一个文件夹作为项目目录（可选）"
              readOnly
              value={path}
              onClick={() => void handlePickDirectory()}
            />
            <Button icon={<FolderOpenOutlined />} loading={picking} onClick={() => void handlePickDirectory()}>
              选择文件夹
            </Button>
          </Space.Compact>
        </Form.Item>
      </Form>
    </Modal>
  )
}
