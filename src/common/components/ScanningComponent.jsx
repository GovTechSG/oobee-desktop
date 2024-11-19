import { useEffect, useState } from 'react'
import LoadingSpinner from '../../common/components/LoadingSpinner'
import checkIcon from '../../assets/check-circle.svg'
import slashCircleIcon from '../../assets/slash-circle.svg'
import crossCircleIcon from '../../assets/cross-circle.svg'
import LoadingScanningStatus from './LoadingScanningStatus'

const ScanningComponent = ({ scanningMessage }) => {
  const [scannedItems, setScannedItems] = useState([])
  const [urlItems, setUrlItems] = useState([])
  const [urlItemComponents, setUrlItemComponents] = useState([])
  const [pagesScanned, setPagesScanned] = useState(0)
  const [displayPageNum, setDisplayPageNum] = useState(0)
  const [scanCompleted, setScanCompleted] = useState(false)
  const [displayPageWord, setDisplayPageWord] = useState('page')

  useEffect(() => {
    if (!scanCompleted) {
      window.services.scanningUrl((urlItem) => {
        if (urlItem.status === 'scanned') {
          const currDisplayPageNum = urlItem.urlScannedNum
          // TODO: Testcode, remove when raising PR
          // const currDisplayPageNum = urlItem.indexOfRandomUrl
          setDisplayPageNum(currDisplayPageNum)
          setPagesScanned(currDisplayPageNum + 1)
        } else {
          setDisplayPageNum(pagesScanned)
        }

        const newUrlItems = [urlItem, ...urlItems]
        setUrlItems(newUrlItems)
        const newUrlItemComponents = [
          ...newUrlItems.map((urlItem, index) => (
            <UrlItemComponent index={index} urlItem={urlItem} />
          )),
        ]
        setUrlItemComponents(newUrlItemComponents)
      })

      // DEV scanningCompleted here refers to the scanning of a single url page, and not the entire scan
      window.services.scanningCompleted(() => {
        setDisplayPageNum(pagesScanned)
        const completedUrlItems = [
          ...urlItems.map((urlItem, index) => (
            <UrlItemComponent
              index={index}
              urlItem={urlItem}
              scanCompleted={true}
            />
          )),
        ]
        setUrlItemComponents(completedUrlItems)
        setScanCompleted(true)
      })
    }
  })

  useEffect(() => {
    setDisplayPageWord(displayPageNum === 1 ? 'page' : 'pages')
  }, [displayPageNum])

  const UrlItemComponent = ({ index, urlItem, scanCompleted }) => {
    const isMostRecent = index === 0
    const urlItemClassName = !isMostRecent
      ? 'scanning-url-list-item fade-in-top'
      : 'scanning-url-list-item'
    const statusIcon = () => {
      if (isMostRecent && !scanCompleted) {
        return <LoadingSpinner></LoadingSpinner>
      } else {
        switch (urlItem.status) {
          case 'scanned': {
            return <img className="scanning-check-icon" src={checkIcon}></img>
          }
          case 'skipped': {
            return (
              <img className="scanning-check-icon" src={slashCircleIcon}></img>
            )
          }
          case 'error': {
            return (
              <img className="scanning-check-icon" src={crossCircleIcon}></img>
            )
          }
        }
      }
    }
    return (
      <li className={urlItemClassName} key={index}>
        {statusIcon()}
        <p className="scanning-url">{urlItem.url}</p>
        {/* // TODO: Testcode, remove when raising PR
         */}
        {/* <p className="scanning-url">{urlItem.randomUrl}</p> */}
      </li>
    )
  }
  return (
    <div className="scanning-component">
      {urlItems.length > 0 ? (
        <>
          <h1 className="scanning-url-title">
            Scanned: {displayPageNum} {displayPageWord}
          </h1>
          <div className="scanning-url-list-container">
            <ul className="scanning-url-list">{urlItemComponents}</ul>
            <div className="blurred-overlay"></div>
          </div>
        </>
      ) : (
        <LoadingScanningStatus scanningMessage={scanningMessage} />
      )}
    </div>
  )
}

export default ScanningComponent
