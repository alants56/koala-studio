import { useEffect, useState, type ReactElement } from 'react'
import { App, Form, Input, Modal } from 'antd'
import type { Project } from '@/models'
import { useProjects } from '@/state/ProjectsContext'
import { readableIpcError } from '@/utils/ipc-error'

interface RenameProjectModalProps {
  open: boolean
  project?: Project
  onClose: () => void
}

interface FormValues {
  name: string
}

/** 侧栏项目行「重命名」用的轻量弹窗：只改名称，不动描述 / 标签 / 文件夹。 */
export function RenameProjectModal({ open, project, onClose }: RenameProjectModalProps): ReactElement {
  const [form] = Form.useForm<FormValues>()
  const { message } = App.useApp()
  const { updateProject } = useProjects()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({ name: project?.name ?? '' })
  }, [form, open, project])

  const handleOk = async (): Promise<void> => {
    if (!project) return
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const name = values.name.trim()
    if (name === project.name) {
      onClose()
      return
    }
    setSubmitting(true)
    try {
      // UpdateProjectInput 是全量的：必须回填原有字段，否则描述 / 标签 / 文件夹会被清空。
      await updateProject(project.id, {
        name,
        description: project.description,
        tags: project.tags,
        path: project.path
      })
      message.success('项目已重命名')
      onClose()
    } catch (error) {
      message.error(readableIpcError(error, '重命名失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="重命名项目"
      open={open}
      onOk={() => void handleOk()}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      width={400}
    >
      <Form form={form} layout="vertical" name="rename-project" style={{ marginTop: 16 }}>
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, whitespace: true, message: '请输入项目名称' },
            { max: 60, message: '名称不能超过 60 个字符' }
          ]}
        >
          <Input placeholder="项目名称" maxLength={60} onPressEnter={() => void handleOk()} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
