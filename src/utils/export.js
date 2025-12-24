import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

export async function exportReport({ element, filename, type }) {
  if (!element) return
  
  // 临时增加样式以优化截图效果
  const originalStyle = element.style.cssText
  element.style.position = 'relative'
  element.style.left = '0'
  element.style.top = '0'
  element.style.width = '1000px' // 固定宽度以保证排版一致
  element.style.margin = '0 auto'
  element.style.transform = 'none'
  
  try {
    const canvas = await html2canvas(element, {
      scale: 2, // 保持清晰度
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 1200, // 模拟更宽的视口
      onclone: (clonedDoc) => {
        // 在截图前可以在这里进一步调整克隆节点的样式
        const clonedElement = clonedDoc.querySelector('.report')
        if (clonedElement) {
          clonedElement.style.display = 'block'
          clonedElement.style.position = 'static'
        }
      }
    })

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8) // 使用 JPEG 并压缩质量到 0.8

    if (type === 'png') {
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `${filename}.jpg` // 改为 jpg 以减小体积
      link.click()
      return
    }

    // A4 尺寸 (pt): 595.28 x 841.89
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    
    const contentWidth = canvas.width
    const contentHeight = canvas.height
    
    // 将图片宽度缩放到 A4 宽度
    const imgWidth = pageWidth
    const imgHeight = (contentHeight * pageWidth) / contentWidth
    
    let position = 0
    let heightLeft = imgHeight

    // 第一页
    pdf.addImage(dataUrl, 'JPEG', 0, position, imgWidth, imgHeight) // 使用 JPEG 格式
    heightLeft -= pageHeight

    // 后续页面
    while (heightLeft > 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(dataUrl, 'JPEG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

    pdf.save(`${filename}.pdf`)
  } finally {
    // 恢复原始样式
    element.style.cssText = originalStyle
  }
}
