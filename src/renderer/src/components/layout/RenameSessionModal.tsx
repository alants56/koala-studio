import { useEffect, useState, type ReactElement } from 'react'
import { App, Form, Input, Modal } from 'antd'
import { readableIpcError } from '@/utils/ipc-error'

interface RenameSessionModalProps {
  open: boolean
  /** 弹窗标题，例如「重命名会话」/「重命名对话」。 */
  heading: string
  /** 表单唯一名：多个弹窗同时挂载时避免字段 id 重复。 */
  formName: string
  initialTitle: string
  /** 提交新标题；成功后弹窗自动关闭，抛错时保持打开并展示原因。 */
  onSubmit: (title: string) => Promise<void>
  onClose: () => void
}

interface FormValues {
  title: string
}

/** 侧栏会话 / 对话行「重命名」共用的轻量弹窗：只改标题，不触碰其他字段。 */
export function RenameSessionModal({ open, heading, formName, initialTitle, onSubmit, onClose }: RenameSessionModalProps): ReactElement {
  const [form] = Form.useForm<FormValues>()
  const { message } = App.useApp()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({ title: initialTitle })
  }, [form, open, initialTitle])

  const handleOk = async (): Promise<void> => {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const title = values.title.trim()
    if (title === initialTitle) {
      onClose()
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(title)
      onClose()
    } catch (error) {
      message.error(readableIpcError(error, '重命名失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={heading}
      open={open}
      onOk={() => void handleOk()}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      width={400}
    >
      <Form form={form} layout="vertical" name={formName} style={{ marginTop: 16 }}>
        <Form.Item
          name="title"
          label="名称"
          rules={[
            { required: true, whitespace: true, message: '请输入名称' },
            { max: 120, message: '名称不能超过 120 个字符' }
          ]}
        >
          <Input placeholder="会话名称" maxLength={120} onPressEnter={() => void handleOk()} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
