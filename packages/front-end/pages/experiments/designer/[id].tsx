import { FC, useEffect, useRef, useState, MouseEvent } from "react";
import useForm from "../../../hooks/useForm";
import { GiClick } from "react-icons/gi";
import clsx from "clsx";
import {
  FaArrowsAltH,
  FaCamera,
  FaCode,
  FaDesktop,
  FaImage,
  FaMobileAlt,
  FaMousePointer,
  FaPaintBrush,
  FaPencilAlt,
  FaPlus,
  FaTabletAlt,
  FaTrash,
} from "react-icons/fa";
import { useRouter } from "next/router";
import useApi from "../../../hooks/useApi";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import LoadingOverlay from "../../../components/LoadingOverlay";
import Button from "../../../components/Button";
import { useAuth } from "../../../services/auth";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { BsArrowClockwise, BsGear } from "react-icons/bs";
import StatusIndicator from "../../../components/Experiment/StatusIndicator";
import TextareaAutosize from "react-textarea-autosize";
import Dropdown from "../../../components/Dropdown/Dropdown";
import DropdownLink from "../../../components/Dropdown/DropdownLink";
import Modal from "../../../components/Modal";
import styles from "./designer.module.scss";
import {
  DomMutation,
  ElementAttribute,
  ElementBreadcrumb,
  IncomingMessage,
  OutgoingMessage,
} from "../../../types/visualDesigner";
import {
  addQueryStringToURL,
  dataURItoBlob,
} from "../../../services/visualDesigner";

const EditorPage: FC = () => {
  const router = useRouter();
  const { id } = router.query;

  const { data, error } = useApi<{
    experiment: ExperimentInterfaceStringDates;
  }>(`/experiment/${id}`);
  const [variation, setVariation] = useState(1);
  const [url, setUrl] = useState("");
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [screenshotModalOpen, setScreenshotModalOpen] = useState(false);
  const [variationData, setVariationData] = useState<{
    url: string;
    variations: {
      dom: DomMutation[];
      css: string;
      screenshot?: string;
    }[];
  }>({ url: "", variations: [] });
  const [zoom, setZoom] = useState(1);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState("desktop");
  const [iframeError, setIframeError] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [value, inputProps, manualUpdate] = useForm({
    editing: false,
    field: "",
    name: "",
    attribute: "",
    value: "",
  });
  const [currentEl, setCurrentEl] = useState<{
    selected: boolean;
    selector: string;
    display: string;
    breadcrumb: ElementBreadcrumb;
    innerHTML?: string;
    attributes?: ElementAttribute[];
    classes?: string[];
  }>({
    selected: false,
    selector: "",
    display: "",
    breadcrumb: [],
  });
  const [mode, setMode] = useState<
    "interactive" | "inspector" | "code" | "css" | "screenshot"
  >("interactive");
  const { apiCall } = useAuth();

  const [stream, setStream] = useState<{
    point1: [number, number];
    point2: [number, number];
    screenshot: string;
    offsetX: number;
    offsetY: number;
    stream: MediaStream;
    displaySurface: "browser" | "monitor" | "window" | "application";
    width: number;
    height: number;
  }>(null);

  const varData = variationData.variations[variation];
  const loaded = data && varData;

  // Set the initial value from the API
  useEffect(() => {
    if (!data) return;
    if (data.experiment.previewURL) {
      setUrl(data.experiment.previewURL);
    }
    setVariationData({
      url: data.experiment.previewURL || "",
      variations: data.experiment.variations.map((v) => {
        return {
          dom: v.dom || [],
          css: v.css || "",
          screenshot: v.screenshots?.[0]?.path || "",
        };
      }),
    });
  }, [data]);

  // Cleanup screenshot stream
  useEffect(() => {
    if (mode !== "screenshot" && stream) {
      stream.stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [mode]);

  // Stop screenshot mode when the stream ends
  useEffect(() => {
    if (
      mode === "screenshot" &&
      stream?.stream?.getVideoTracks()?.[0]?.readyState === "ended"
    ) {
      setMode("interactive");
    }
  }, [mode, stream?.stream?.getVideoTracks()?.[0]?.readyState]);

  function sendCommand(command: IncomingMessage) {
    if (!loaded || !iframe.current) return;
    if (!iframeReady && command.command !== "isReady") return;
    try {
      iframe.current.contentWindow.postMessage(command, "*");
    } catch (e) {
      console.error(e);
    }
  }

  function render() {
    if (!loaded) return;
    sendCommand({
      command: "mutateDOM",
      mutations: varData.dom.filter((d) => d.selector),
    });
    sendCommand({
      command: "injectCSS",
      css: varData.css,
    });

    if (mode === "inspector" && currentEl?.selected) {
      requestAnimationFrame(() => {
        sendCommand({
          command: "selectElement",
          selector: currentEl?.selector,
          ancestor: 0,
        });
      });
    }
  }

  // Render when the value changes, at most once every 100ms
  useEffect(() => {
    const timer = setTimeout(render, 100);
    return () => clearTimeout(timer);
  }, [iframeReady, varData, variation]);

  // When the url changes, reload the iframe
  useEffect(() => {
    setIframeReady(false);
    setIframeLoaded(false);
    setIframeError(false);
  }, [url]);

  // When the iframe loads, wait 1s before showing an error message about missing the visual-designer.js script
  useEffect(() => {
    if (!iframeReady) {
      sendCommand({
        command: "isReady",
      });
    }
    if (iframeLoaded && !iframeReady) {
      const timer = setTimeout(() => {
        setIframeError(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [iframeReady, iframeLoaded]);

  // When the dev inspector mode changes, update the iframe state
  useEffect(() => {
    if (mode === "inspector" && !currentEl?.selected) {
      sendCommand({
        command: "startInspecting",
      });
      sendCommand({
        command: "selectElement",
        selector: "",
        ancestor: 0,
      });
    } else {
      sendCommand({
        command: "stopInspecting",
      });
      if (mode === "inspector" && currentEl?.selected) {
        sendCommand({
          command: "selectElement",
          selector: currentEl.selector,
          ancestor: 0,
        });
      } else if (mode !== "inspector") {
        sendCommand({
          command: "selectElement",
          selector: "",
          ancestor: 0,
        });
      }
    }
  }, [iframe.current, iframeReady, mode, loaded, currentEl?.selected]);

  function updateValue(
    newValue: Partial<{ dom: DomMutation[]; css: string; screenshot: string }>
  ) {
    const clone = [...variationData.variations];
    clone[variation] = {
      ...clone[variation],
      ...newValue,
    };
    setVariationData({
      ...variationData,
      variations: clone,
    });
  }

  const addDomMod = (mutation: DomMutation) => {
    const newList: DomMutation[] = [];

    let applyNew = true;
    varData.dom.forEach((change) => {
      // Skip some changes if the new dom mod will overwrite it
      if (
        change.selector === mutation.selector &&
        change.attribute === mutation.attribute
      ) {
        if (mutation.action === "set") {
          return;
        }
        if (
          mutation.action === "append" &&
          change.action === "remove" &&
          mutation.value === change.value
        ) {
          applyNew = false;
          return;
        }
        if (
          mutation.action === "remove" &&
          change.action === "append" &&
          mutation.value === change.value
        ) {
          applyNew = false;
          return;
        }
      }
      newList.push(change);
    });

    if (applyNew) {
      newList.push(mutation);
    }

    updateValue({
      dom: newList,
    });
  };
  const removeDomMod = (i: number) => {
    const clone = [...varData.dom];
    clone.splice(i, 1);
    updateValue({ dom: clone });
  };

  // Respond to iframe events
  useEffect(() => {
    if (!loaded) return;

    // eslint-disable-next-line
    const listener = (event: MessageEvent) => {
      const data: OutgoingMessage = event.data;
      if (data.event === "visualDesignerReady") {
        setIframeLoaded(true);
        setIframeReady(true);
      } else if (data.event === "elementHover") {
        setCurrentEl({
          selected: false,
          selector: data.selector,
          display: data.display,
          breadcrumb: data.breadcrumb,
        });
      } else if (data.event === "elementSelected") {
        const classes = (
          data.attributes.filter((val) => val.name === "class")?.[0]?.value ||
          ""
        )
          .split(/\s+/g)
          .filter(Boolean);

        const otherAttrs = data.attributes.filter(
          (val) => val.name !== "class"
        );
        setCurrentEl({
          selected: true,
          selector: data.selector,
          display: data.display,
          breadcrumb: data.breadcrumb,
          attributes: otherAttrs,
          classes: classes,
          innerHTML: data.innerHTML,
        });
      }
    };
    window.addEventListener("message", listener, false);
    return () => window.removeEventListener("message", listener, false);
  }, [variation, loaded]);

  if (error) {
    return <div>There was a problem loading the experiment</div>;
  }
  if (!loaded) {
    return <LoadingOverlay />;
  }

  const variations = data.experiment.variations;

  let iframeWidth = `100%`;
  let transformOrigin = "50% 0";
  if (device === "mobile") {
    iframeWidth = "375px";
  } else if (device === "tablet") {
    iframeWidth = "768px";
  } else if (device === "desktop") {
    iframeWidth = "1100px";
  } else {
    iframeWidth = `${100 / zoom}%`;
    transformOrigin = "0 0";
  }
  const iframeContainerWidth = device === "window" ? "100%" : iframeWidth;

  const numChanges = varData.dom.length + (varData.css.length > 0 ? 1 : 0);
  const numCssRules = (varData.css.match(/\{/g) || []).length;

  function getXY(
    e: MouseEvent<HTMLDivElement, globalThis.MouseEvent>
  ): [number, number] {
    return [e.clientX, e.clientY];
  }

  return (
    <div className={styles.designer}>
      {screenshotModalOpen && varData.screenshot && (
        <Modal
          header="Variation Screenshot"
          open={true}
          close={() => setScreenshotModalOpen(false)}
          submit={async () => {
            updateValue({
              screenshot: "",
            });
          }}
          cta="Delete"
          submitColor="danger"
          size="max"
        >
          <img
            src={varData.screenshot}
            className={clsx("border", styles.screenshotModalImage)}
          />
        </Modal>
      )}
      {mode === "screenshot" && stream?.screenshot && (
        <div className={styles.screenshotPrompt}>
          <div className="mb-2">
            <img src={stream.screenshot} />
          </div>
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              updateValue({
                screenshot: stream.screenshot,
              });
              setMode("interactive");
            }}
          >
            Save Screenshot
          </button>
          <button
            className="btn btn-link text-light"
            onClick={(e) => {
              e.preventDefault();
              setStream({
                ...stream,
                screenshot: null,
                point1: null,
                point2: null,
              });
            }}
          >
            Try Again
          </button>
        </div>
      )}
      {mode === "screenshot" && stream && !stream.screenshot && (
        <div
          className={styles.screenshotOverlay}
          onMouseDown={(e) => {
            const xy = getXY(e);

            let offsetX = 0,
              offsetY = 0;
            if (stream.displaySurface !== "browser") {
              offsetX = e.screenX - e.clientX;
              offsetY = e.screenY - e.clientY;
            }

            setStream({
              ...stream,
              point1: xy,
              point2: xy,
              offsetX,
              offsetY,
            });
          }}
          onMouseMove={(e) => {
            const xy = getXY(e);

            setStream({
              ...stream,
              point2: xy,
            });
          }}
          onMouseUp={async () => {
            if (!stream.point1 || !stream.point2) return;

            try {
              // make sure a big enough area was selected
              const w = Math.abs(stream.point2[0] - stream.point1[0]);
              const h = Math.abs(stream.point2[1] - stream.point1[1]);
              if (w < 20 || h < 20) {
                setStream({
                  ...stream,
                  point1: undefined,
                  point2: undefined,
                });
              } else {
                const video = document.createElement("video");
                video.autoplay = true;
                video.srcObject = stream.stream;
                video.onplay = () => {
                  const canvas = document.createElement("canvas");
                  const adjustedW = w - 6;
                  const adjustedH = h - 6;
                  const adjustedX =
                    Math.min(stream.point1[0], stream.point2[0]) +
                    3 +
                    stream.offsetX;
                  const adjustedY =
                    Math.min(stream.point1[1], stream.point2[1]) +
                    3 +
                    stream.offsetY;
                  canvas.width = adjustedW;
                  canvas.height = adjustedH;
                  const ctx = canvas.getContext("2d");
                  ctx.drawImage(
                    video,
                    adjustedX,
                    adjustedY,
                    adjustedW,
                    adjustedH,
                    0,
                    0,
                    adjustedW,
                    adjustedH
                  );
                  const image = canvas.toDataURL();
                  setStream({
                    ...stream,
                    screenshot: image,
                  });
                  video.remove();
                };
              }
            } catch (e) {
              console.error(e);
            }
          }}
        >
          {stream.point1 && stream.point2 && !stream.screenshot && (
            <div
              style={{
                top: Math.min(stream.point1[1], stream.point2[1]),
                left: Math.min(stream.point1[0], stream.point2[0]),
                width: Math.abs(stream.point1[0] - stream.point2[0]),
                height: Math.abs(stream.point1[1] - stream.point2[1]),
              }}
            />
          )}
        </div>
      )}
      {urlModalOpen && (
        <Modal
          header="Change Preview URL"
          open={true}
          close={() => setUrlModalOpen(false)}
          submit={async () => {
            setUrl(variationData.url);
          }}
        >
          <div className="form-group">
            Preview URL
            <input
              type="text"
              className="form-control"
              value={variationData.url}
              onChange={(e) => {
                setVariationData({
                  ...variationData,
                  url: e.target.value,
                });
              }}
            />
          </div>
        </Modal>
      )}
      <div className={styles.iframeHolder}>
        <div
          style={{
            height: "100%",
            width: iframeContainerWidth,
            margin: "0 auto",
            overflow: "hidden",
          }}
        >
          {url && (
            <iframe
              src={addQueryStringToURL(url)}
              style={{
                height: 100 / zoom + "%",
                border: 0,
                width: iframeWidth,
                margin: "0 auto",
                transform: `scale(${zoom})`,
                transformOrigin: transformOrigin,
              }}
              ref={iframe}
              onLoad={() => {
                setIframeLoaded(true);
              }}
            />
          )}
        </div>
        {!iframeReady && (
          <div
            className={clsx(
              "d-flex text-light flex-column justify-content-center",
              styles.iframeError
            )}
          >
            <div>
              {url && iframeError ? (
                <div>
                  <div className="alert alert-warning">
                    The URL has loaded, but we are unable to communicate with it
                    yet. Make sure the page is loading this script:
                    <div>
                      <code>{`<script async src="https://cdn.growthbook.io/visual-designer.js"></script>`}</code>
                    </div>
                    <div className="mt-4">
                      After adding the script:
                      <br />
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={(e) => {
                          e.preventDefault();
                          setIframeReady(false);
                          setIframeLoaded(false);
                          setIframeError(false);
                          iframe.current.src = iframe.current.src + "";
                        }}
                      >
                        Reload
                      </button>
                    </div>
                  </div>
                </div>
              ) : !url && loaded ? (
                <div className="alert alert-info">
                  No Preview URL set for the visual designer.
                  <div className="pt-2">
                    <button
                      className="btn btn-primary"
                      onClick={(e) => {
                        e.preventDefault();
                        setUrlModalOpen(true);
                      }}
                    >
                      Set URL
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <LoadingSpinner /> Loading...
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className={clsx(styles.topBar, "px-2 bg-dark text-light")}>
        <div className="row align-items-center h-100">
          <div className="col-auto text-left">
            <img alt="Growth Book" src="/logo/growth-book-name-white.svg" />
            <div className="pl-1">
              <small>Visual Designer</small>
            </div>
          </div>
          <div className="col-auto">
            <select
              value={variation}
              className="form-control"
              onChange={(e) => {
                setVariation(parseInt(e.target.value) || 0);
              }}
            >
              {variations.map((v, i) => (
                <option key={i} value={i}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col text-left d-flex">
            <div className="mr-2 d-none d-lg-block">{data.experiment.name}</div>
            <div className="d-none d-lg-block">
              <StatusIndicator
                archived={data.experiment.archived}
                status={data.experiment.status}
              />
            </div>
          </div>
          {varData?.screenshot && (
            <div className="col-auto">
              <a
                href="#"
                className={clsx(styles.screenshotIcon, "text-light")}
                onClick={(e) => {
                  e.preventDefault();
                  setScreenshotModalOpen(true);
                }}
                title="Screenshot"
              >
                <FaImage />
              </a>
            </div>
          )}
          <div className="col-auto">
            <Dropdown
              uuid="designer-changes"
              toggle={
                <>
                  Changes{" "}
                  <span
                    className={`badge badge-${
                      numChanges > 0 ? "danger" : "secondary"
                    }`}
                  >
                    {numChanges}
                  </span>
                </>
              }
            >
              {varData.css.length > 0 && (
                <DropdownLink
                  onClick={() => {
                    setMode("css");
                  }}
                >
                  CSS Styles ({numCssRules})
                </DropdownLink>
              )}
              {varData.dom.map(({ selector, action, attribute, value }, i) => (
                <>
                  <div className="dropdown-divider" />
                  <div className="dropdown-item" key={i}>
                    <div className="d-flex">
                      <div className="flex-1">
                        {action} {attribute}{" "}
                        <small className="text-muted">{selector}</small>
                        <textarea
                          readOnly
                          rows={Math.min(value.split(/\n/g).length, 4)}
                          className="form-control"
                          value={value}
                        />
                      </div>
                      <div className="ml-2">
                        <button
                          className={clsx(
                            styles.closeIcon,
                            "btn btn-outline-danger"
                          )}
                          onClick={(e) => {
                            e.preventDefault();
                            removeDomMod(i);
                          }}
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ))}
            </Dropdown>
          </div>
          <div className="col-auto">
            <Button
              color="primary"
              onClick={async () => {
                const variationsClone = [...variations];
                variationData.variations.forEach((val, i) => {
                  variationsClone[i] = {
                    ...variationsClone[i],
                    dom: val.dom,
                    css: val.css,
                  };
                });

                const promises = variationData.variations.map(async (v, i) => {
                  if (!v.screenshot || !v.screenshot.match(/^data/)) return;

                  const ext = "png";

                  const { uploadURL, fileURL } = await apiCall<{
                    uploadURL: string;
                    fileURL: string;
                  }>(`/experiment/${data.experiment.id}/upload/${ext}`, {
                    method: "POST",
                  });

                  const blob = dataURItoBlob(v.screenshot);
                  const file = new File([blob], "screenshot.png");

                  const res = await fetch(uploadURL, {
                    method: "PUT",
                    headers: {
                      "Content-Type": "image/png",
                    },
                    body: file,
                  });
                  if (!res.ok) {
                    console.error(res);
                    throw new Error("Failed to upload screenshot");
                  }

                  variationsClone[i].screenshots =
                    variationsClone[i].screenshots || [];
                  variationsClone[i].screenshots.push({
                    path: fileURL,
                    description: "",
                  });
                });
                await Promise.all(promises);

                await apiCall(`/experiment/${id}`, {
                  method: "POST",
                  body: JSON.stringify({
                    variations: variationsClone,
                    previewURL: url,
                  }),
                });

                router.push(`/experiment/${data.experiment.id}`);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
      <div className={clsx(styles.subBar, "bg-light border-bottom px-2")}>
        <div className="row h-100 align-items-center">
          <div className="col-auto">
            Mode:{" "}
            <div className="btn-group">
              <button
                className={clsx("btn btn-outline-secondary btn-sm", {
                  active: mode === "interactive",
                })}
                title="Interactive"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("interactive");
                }}
              >
                <FaMousePointer />
              </button>
              <button
                className={clsx("btn btn-outline-secondary btn-sm", {
                  active: mode === "inspector",
                })}
                title="Element Selector"
                onClick={(e) => {
                  e.preventDefault();
                  setCurrentEl({
                    selected: false,
                    selector: "",
                    breadcrumb: [],
                    display: "",
                  });
                  setMode("inspector");
                }}
              >
                <GiClick />
              </button>
              <button
                className={clsx("btn btn-outline-secondary btn-sm", {
                  active: mode === "css",
                })}
                title="CSS"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("css");
                }}
              >
                <FaPaintBrush />
              </button>
              <button
                className={clsx("btn btn-outline-secondary btn-sm", {
                  active: mode === "code",
                })}
                title="DOM Mutations"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("code");
                  manualUpdate({
                    field: "",
                    name: "addClass",
                    value: "",
                    attribute: "",
                  });
                }}
              >
                <FaCode />
              </button>
              <button
                className={clsx(
                  "btn btn-outline-secondary btn-sm d-none d-lg-inline-block",
                  {
                    active: mode === "screenshot",
                  }
                )}
                title="Screenshot"
                onClick={async (e) => {
                  e.preventDefault();
                  try {
                    // eslint-disable-next-line
                      // @ts-ignore
                    const captureStream = await navigator.mediaDevices.getDisplayMedia(
                      {
                        video: {
                          cursor: "never",
                        },
                        audio: false,
                      }
                    );
                    const settings = captureStream
                      .getVideoTracks()[0]
                      .getSettings();

                    if (settings.displaySurface === "window") {
                      captureStream
                        .getTracks()
                        .forEach((track: MediaStreamTrack) => track.stop());
                      throw new Error(
                        "Please choose to share either your entire screen or a specific tab."
                      );
                    }

                    setStream({
                      stream: captureStream,
                      ...settings,
                    });
                    setMode("screenshot");
                  } catch (e) {
                    alert(e.message);
                  }
                }}
              >
                <FaCamera />
              </button>
            </div>
          </div>
          <div className="col text-left">
            {mode === "interactive" && (
              <div className="d-none d-lg-block">
                <em>Interactive Mode (editing disabled)</em>
              </div>
            )}
            {mode === "inspector" && (
              <>
                {currentEl.selector && (
                  <div className={clsx(styles.breadcrumb, "d-none d-lg-block")}>
                    {currentEl.breadcrumb.map((display, i) => {
                      if (display.toLowerCase() === "html") return null;
                      return (
                        <span key={i}>
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              sendCommand({
                                command: "selectElement",
                                selector: currentEl.selector,
                                ancestor: currentEl.breadcrumb.length - i,
                              });
                            }}
                            onMouseEnter={() => {
                              console.log(
                                "hover",
                                i,
                                currentEl.breadcrumb.length,
                                currentEl.breadcrumb.length - i
                              );
                              sendCommand({
                                command: "hoverElement",
                                selector: currentEl.selector,
                                ancestor: currentEl.breadcrumb.length - i,
                              });
                            }}
                            onMouseLeave={() => {
                              sendCommand({
                                command: "hoverElement",
                                selector: "",
                                ancestor: 0,
                              });
                            }}
                          >
                            {display.toLowerCase()}
                          </a>{" "}
                          &gt;{" "}
                        </span>
                      );
                    })}
                    <strong>{currentEl.display.toLowerCase()}</strong>
                  </div>
                )}
                {!currentEl.selector && (
                  <em>Inspector (click page element to edit)</em>
                )}
              </>
            )}
            {mode === "css" && (
              <div>
                <em>Inject CSS styles into the page</em>
              </div>
            )}
            {mode === "code" && (
              <div>
                <em>Manually mutate DOM elements</em>
              </div>
            )}
            {mode === "screenshot" && (
              <div>
                <em>
                  Click and drag to select the area you want to screenshot
                </em>
              </div>
            )}
          </div>
          <div className="col-auto">
            <select
              className="form-control form-control-sm"
              value={zoom}
              onChange={(e) => {
                setZoom(parseFloat(e.target.value) || 1);
              }}
            >
              <option value="1">100%</option>
              <option value="0.75">75%</option>
              <option value="0.5">50%</option>
            </select>
          </div>
          <div className="col-auto">
            <div className="btn-group">
              <button
                className={clsx("btn btn-outline-secondary btn-sm", {
                  active: device === "mobile",
                })}
                onClick={(e) => {
                  e.preventDefault();
                  setDevice("mobile");
                }}
              >
                <FaMobileAlt />
              </button>
              <button
                className={clsx("btn btn-outline-secondary btn-sm", {
                  active: device === "tablet",
                })}
                onClick={(e) => {
                  e.preventDefault();
                  setDevice("tablet");
                }}
              >
                <FaTabletAlt />
              </button>
              <button
                className={clsx("btn btn-outline-secondary btn-sm", {
                  active: device === "desktop",
                })}
                onClick={(e) => {
                  e.preventDefault();
                  setDevice("desktop");
                }}
              >
                <FaDesktop />
              </button>
              <button
                className={clsx("btn btn-outline-secondary btn-sm", {
                  active: device === "window",
                })}
                onClick={(e) => {
                  e.preventDefault();
                  setDevice("window");
                }}
                title="Use browser width"
              >
                <FaArrowsAltH />
              </button>
            </div>
          </div>
          <div className="col-auto">
            <button
              className="btn btn-link btn-sm mr-2"
              onClick={(e) => {
                e.preventDefault();
                setUrlModalOpen(true);
              }}
            >
              <BsGear /> Change URL
            </button>
            <button
              className="btn btn-link btn-sm"
              onClick={(e) => {
                e.preventDefault();
                if (variationData.url === url) {
                  setIframeReady(false);
                  setIframeLoaded(false);
                  setIframeError(false);
                  iframe.current.src = iframe.current.src + "";
                } else {
                  setUrl(variationData.url);
                }
              }}
            >
              <BsArrowClockwise /> Refresh
            </button>
          </div>
        </div>
      </div>
      {((mode === "inspector" && currentEl.selected) ||
        mode === "css" ||
        mode === "code") && (
        <div
          className={clsx(
            "bg-dark text-light rounded p-3 text-left",
            styles.panel
          )}
        >
          <button
            className={clsx(styles.closeIcon, "btn btn-danger")}
            onClick={(e) => {
              e.preventDefault();
              setMode("interactive");
            }}
          >
            &times;
          </button>
          {mode === "inspector" && currentEl.selected && (
            <>
              <h3 className="border-bottom pb-2 mb-2">Element Details</h3>
              <div className="form-group">
                Selector
                <input
                  type="text"
                  className="form-control"
                  disabled
                  value={currentEl.selector}
                />
              </div>
              <div className="form-group">
                Contents
                {!value.editing && (
                  <div className="float-right">
                    <a
                      href="#"
                      className="text-light pr-3"
                      onClick={(e) => {
                        e.preventDefault();
                        manualUpdate({
                          editing: true,
                          field: "html",
                          name: "set",
                          value: currentEl.innerHTML,
                        });
                      }}
                    >
                      <FaPencilAlt /> edit
                    </a>
                    <a
                      href="#"
                      className="text-light"
                      onClick={(e) => {
                        e.preventDefault();
                        manualUpdate({
                          editing: true,
                          field: "html",
                          name: "append",
                          value: "",
                        });
                      }}
                    >
                      <FaPlus />
                      append
                    </a>
                  </div>
                )}
                <TextareaAutosize
                  minRows={1}
                  disabled={!value.editing || value.field !== "html"}
                  maxRows={value.editing && value.field === "html" ? 20 : 3}
                  autoFocus={value.editing && value.field === "html"}
                  className="form-control mt-1"
                  value={
                    value.editing && value.field === "html"
                      ? value.value
                      : currentEl.innerHTML
                  }
                  onChange={(e) => {
                    manualUpdate({
                      value: e.target.value,
                    });
                  }}
                />
                {value.editing && value.field === "html" && (
                  <>
                    <button
                      className="btn btn-primary mt-1"
                      onClick={(e) => {
                        e.preventDefault();
                        addDomMod({
                          selector: currentEl.selector,
                          action: value.name === "append" ? "append" : "set",
                          attribute: "html",
                          value: value.value,
                        });
                        setCurrentEl({
                          ...currentEl,
                          innerHTML:
                            value.name === "append"
                              ? currentEl.innerHTML + value.value
                              : value.value,
                        });
                        manualUpdate({
                          editing: false,
                        });
                      }}
                    >
                      Save
                    </button>
                    <button
                      className="btn btn-link text-light mt-1"
                      onClick={(e) => {
                        e.preventDefault();
                        manualUpdate({
                          editing: false,
                        });
                      }}
                    >
                      cancel
                    </button>
                  </>
                )}
              </div>
              <div className="form-group">
                <div>
                  Classes
                  {!value.editing && (
                    <a
                      href="#"
                      className="text-light float-right"
                      onClick={(e) => {
                        e.preventDefault();
                        manualUpdate({
                          editing: true,
                          field: "class",
                          value: "",
                        });
                      }}
                    >
                      <FaPlus /> add
                    </a>
                  )}
                </div>
                {value.editing && value.field === "class" && (
                  <div>
                    <input
                      type="text"
                      autoFocus
                      className="form-control"
                      {...inputProps.value}
                    />
                    <button
                      className="btn btn-primary mt-1"
                      onClick={(e) => {
                        e.preventDefault();
                        if (!currentEl.classes.includes(value.value)) {
                          addDomMod({
                            selector: currentEl.selector,
                            action: "append",
                            attribute: "class",
                            value: value.value,
                          });
                          setCurrentEl({
                            ...currentEl,
                            classes: [...currentEl.classes, value.value],
                          });
                        }
                        manualUpdate({
                          editing: false,
                        });
                      }}
                    >
                      Add
                    </button>
                    <button
                      className="btn btn-link text-light mt-1"
                      onClick={(e) => {
                        e.preventDefault();
                        manualUpdate({
                          editing: false,
                        });
                      }}
                    >
                      cancel
                    </button>
                  </div>
                )}
                {(!value.editing || value.field !== "class") &&
                  (currentEl.classes.length > 0 ? (
                    <ul className="list-group mt-1">
                      {currentEl.classes.map((c, j) => (
                        <li
                          className="list-group-item py-1 text-dark bg-light d-flex justify-content-between align-items-center"
                          key={c}
                        >
                          {c}
                          <a
                            href="#"
                            className="text-danger"
                            onClick={(e) => {
                              e.preventDefault();
                              addDomMod({
                                selector: currentEl.selector,
                                action: "remove",
                                attribute: "class",
                                value: c,
                              });
                              const clone = [...currentEl.classes];
                              clone.splice(j, 1);
                              setCurrentEl({
                                ...currentEl,
                                classes: clone,
                              });
                            }}
                          >
                            <FaTrash />
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <small className="text-muted">
                      <em>None</em>
                    </small>
                  ))}
              </div>
              <div className="form-group">
                <div>
                  HTML Attributes
                  {!value.editing && (
                    <a
                      href="#"
                      className="text-light float-right"
                      onClick={(e) => {
                        e.preventDefault();
                        manualUpdate({
                          editing: true,
                          field: "attribute",
                          name: "",
                          value: "",
                        });
                      }}
                    >
                      <FaPlus /> add
                    </a>
                  )}
                </div>
                {value.editing && value.field === "attribute" && (
                  <div>
                    <input
                      type="text"
                      autoFocus
                      className="form-control"
                      placeholder="attributeName"
                      {...inputProps.name}
                    />
                    <input
                      type="text"
                      className="form-control"
                      placeholder="value"
                      {...inputProps.value}
                    />
                    <button
                      className="btn btn-primary mt-1"
                      onClick={(e) => {
                        e.preventDefault();
                        addDomMod({
                          selector: currentEl.selector,
                          action: "set",
                          attribute: value.name,
                          value: value.value,
                        });
                        setCurrentEl({
                          ...currentEl,
                          attributes: [
                            ...currentEl.attributes.filter(
                              (attr) => attr.name !== value.name
                            ),
                            {
                              name: value.name,
                              value: value.value,
                            },
                          ],
                        });
                        manualUpdate({
                          editing: false,
                        });
                      }}
                    >
                      Save
                    </button>
                    <button
                      className="btn btn-link text-light mt-1"
                      onClick={(e) => {
                        e.preventDefault();
                        manualUpdate({
                          editing: false,
                        });
                      }}
                    >
                      cancel
                    </button>
                  </div>
                )}
                {(!value.editing || value.field !== "attribute") &&
                  (currentEl.attributes.length > 0 ? (
                    <ul className="list-group mt-1">
                      {currentEl.attributes.map((attr, j) => (
                        <li
                          className="list-group-item py-1 text-dark bg-light d-flex justify-content-between align-items-center"
                          key={attr.name}
                        >
                          {attr.name} = &quot;{attr.value}&quot;
                          <div style={{ whiteSpace: "nowrap" }}>
                            <a
                              href="#"
                              className="mr-2"
                              onClick={(e) => {
                                e.preventDefault();
                                manualUpdate({
                                  editing: true,
                                  field: "attribute",
                                  name: attr.name,
                                  value: attr.value,
                                });
                              }}
                            >
                              <FaPencilAlt />
                            </a>
                            <a
                              href="#"
                              className="text-danger"
                              onClick={(e) => {
                                e.preventDefault();
                                addDomMod({
                                  selector: currentEl.selector,
                                  action: "set",
                                  attribute: value.name,
                                  value: "",
                                });
                                const clone = [...currentEl.attributes];
                                clone.splice(j, 1);
                                setCurrentEl({
                                  ...currentEl,
                                  attributes: clone,
                                });
                              }}
                            >
                              <FaTrash />
                            </a>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <small className="text-muted">
                      <em>None</em>
                    </small>
                  ))}
              </div>
            </>
          )}
          {mode === "css" && (
            <>
              <h3>Variation CSS</h3>
              <TextareaAutosize
                minRows={8}
                maxRows={25}
                autoFocus={true}
                className="form-control h-100"
                value={varData.css}
                onChange={(e) => {
                  updateValue({
                    css: e.target.value,
                  });
                }}
              />
            </>
          )}
          {mode === "code" && (
            <>
              <h3>DOM Mutations</h3>
              <div className="form-group">
                Selector
                <input
                  type="text"
                  className="form-control"
                  {...inputProps.field}
                  onBlur={() => {
                    sendCommand({
                      command: "selectElement",
                      selector: value.field,
                      ancestor: 0,
                    });
                  }}
                />
              </div>
              <div className="form-group">
                Action
                <select className="form-control" {...inputProps.name}>
                  <option value="set">set</option>
                  <option value="append">append</option>
                  <option value="remove">remove</option>
                </select>
              </div>
              <div className="form-group">
                Attribute
                <input
                  type="text"
                  className="form-control"
                  {...inputProps.attribute}
                />
              </div>
              <div className="form-group">
                Value
                <input
                  type="text"
                  className="form-control"
                  {...inputProps.value}
                />
                {value.name === "setAttribute" && (
                  <small className="form-text">
                    Use for format <code>attr=&quot;value&quot;</code> (e.g.{" "}
                    <code>href=&quot;/&quot;</code>)
                  </small>
                )}
              </div>
              <button
                className="btn btn-primary btn-block"
                onClick={(e) => {
                  e.preventDefault();
                  if (!value.field.length) return;
                  addDomMod({
                    selector: value.field,
                    action: (value.name || "set") as
                      | "set"
                      | "append"
                      | "remove",
                    attribute: value.attribute,
                    value: value.value,
                  });
                  manualUpdate({
                    field: "",
                    name: "addClass",
                    value: "",
                    attribute: "",
                  });
                }}
              >
                Add Mutation
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
export default EditorPage;