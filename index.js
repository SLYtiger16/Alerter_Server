/////////////////////////////////////////////////////////////
///////////DONT FORGET: sudo service mongodb start///////////
/////////////////////////////////////////////////////////////

//Import required scripts
const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const socketIo = require("socket.io");
const router = express.Router();
const moment = require("moment");
const mongo = require("mongodb");
const settings = require("./settings");
const path = require("path");

//Init server
const app = express();
//Apply body-parser middle-ware to interpret http request body
app.use(bodyParser.urlencoded({ extended: true }));
//Apply a relative path build for the status page to use when requesting html assets
app.use(express.static(path.join(__dirname, "/status/build")));
//Send the status page react html from the build folder when requested
app.get("/", function(req, res) {
  res.sendFile(path.join(__dirname, "/status/build", "index.html"));
});
//Apply basic auth middleware to verify authority to send alert
app.use((req, res, next) => {
  //Parse login and password from headers
  const b64auth = (req.headers.authorization || "").split(" ")[1] || "";
  const [login, password] = new Buffer(b64auth, "base64").toString().split(":");
  //Verify login and password are set and correct
  if (
    !login ||
    !password ||
    login !== settings.auth.login ||
    password !== settings.auth.password
  )
    res.status(401).send("ERROR: Authentication required.");
  //Access granted...
  next();
});
//Create server instance
const server = http.createServer(app);
//Pass server instance to socket.io instance to initiate the socket
const io = socketIo(server);

//Create alert factory
class alert_factory {
  constructor(data) {
    this._id = new mongo.ObjectId();
    this.msg = "test";
    this.unit = "610";
    this.use_audio = 0;
    this.use_visual = 0;
    this.call = moment().toDate();
    this.response = null;
    this.audio_success = 0;
    this.visual_success = 0;
    this.alert_all = false;
    this.alert_all_branch = false;
    this.branch = "";
    this.test = false;
    this.name = "";
    if (data) Object.assign(this, data);
  }
}

//Make a connection to the mongo database and operate server within database connection
mongo.MongoClient.connect(settings.db_server, { useNewUrlParser: true })
  .then(client => {
    //Select a collection
    console.log("Database connection successful");
    const db = client.db(settings.db_name);
    const pi_list_col = db.collection(settings.pi_list_col_name);
    const http_req_col = db.collection(settings.http_req_col_name);

    //Create a namespace in the url for pi's to connect to called devices
    const devices = io.of("/devices");
    //Set larger scope of ping test interval
    let last_ping_interval;
    //Set larger scope of status udate timeout
    let status_update_timeout;
    //Set connection method for /devices namespace
    devices.on("connection", socket => {
      //Set register method for /devices namespace
      socket.on("register", data => {
        //Join the newly connected pi to the socket branch requested
        socket.join(data.branch);
        //Find existing pi in the database and update it
        pi_list_col
          .findOneAndUpdate(
            { ip: data.ip },
            {
              $set: {
                branch: String(data.branch),
                ip: String(data.ip),
                name: String(data.name),
                last_ping: moment().toDate(),
                version: String(data.version),
                show: true,
                socket_id: String(socket.id) || "NA",
                error: false
              }
            },
            { projection: { alerts: false, tests: false } }
          )
          .then(item => {
            //If pi is not found then insert a new one
            if (item === null || item.value === null) {
              pi_list_col
                .insertOne({
                  _id: new mongo.ObjectId(),
                  branch: String(data.branch),
                  ip: String(data.ip),
                  name: String(data.name),
                  last_ping: moment().toDate(),
                  version: String(data.version),
                  show: true,
                  socket_id: String(socket.id) || "NA",
                  alerts: [],
                  error: false,
                  tests: []
                })
                .then(item => {
                  socket.emit("registered", socket.id);
                  console.log(`"${data.name}" created in "${data.branch}"`);
                })
                .catch(err => console.error(err));
            } else {
              //If the pi existed and was updated then emit a register confirmation to the pi including the new socket id
              socket.emit("registered", socket.id);
              console.log(`"${data.name}" reconnected in "${data.branch}"`);
            }
          })
          .catch(err => console.error(err));
      });

      //Set error method for /devices namespace
      socket.on("pi_error", data =>
        pi_list_col
          .findOneAndUpdate(
            { socket_id: socket.id, name: data.name, branch: data.branch },
            {
              $set: {
                last_ping: moment().toDate(),
                version: String(data.version),
                error: String(data.error)
              }
            },
            { projection: { alerts: false, tests: false } }
          )
          .then(item =>
            console.log(
              `ERROR REPORTED BY : ${socket.id} named '${data.name}' in '${
                data.branch
              }' ERROR: ${data.error}`
            )
          )
          .catch(err => console.error(err))
      );

      //Clear ping test interval
      if (last_ping_interval) clearInterval(last_ping_interval);
      //Clear status update tiemout
      if (status_update_timeout) clearTimeout(status_update_timeout);
      //Create a test alert without audio or visual
      last_ping_interval = setInterval(() => {
        const test_data = new alert_factory({
          msg: "test",
          unit: "000",
          test: true
        });
        //Store alert in the appropriate pi alert array
        pi_list_col
          .updateOne(
            {
              socket_id: socket.id
            },
            {
              $push: {
                tests: { $each: [test_data], $slice: -10000 }
              }
            }
          )
          //Emit alert test
          .then(() => {
            socket.emit("test", test_data);
            console.log("Test-Alert Sent");
            //Set current status to database
            status_update_timeout = setTimeout(() => {
              pi_list_col
                .find({}, { alerts: false, tests: false })
                .toArray()
                .then(res => {
                  for (pi in res) {
                    if (
                      moment(res[pi].last_ping) < moment().subtract(1, "minute")
                    ) {
                      pi_list_col.updateOne(
                        { _id: mongo.ObjectId(res[pi]._id) },
                        { $set: { socket_id: "NA", error: "failed ping" } }
                      );
                    }
                  }
                })
                .catch(err => console.error(err));
              //Run status_update_timeout 5 seconds after test
            }, 5 * 1000);
          })
          .catch(err => console.error(err));
        //Run alert test every 10 seconds
      }, 10 * 1000);

      //Set feedback method for /devices namespace
      //Find the alert which was sent to the pi and update the response time from the pi
      socket.on("feedback", data => {
        const ping_update = moment();
        pi_list_col
          .findOneAndUpdate(
            {
              socket_id: socket.id,
              [`${
                data.test === true || data.test === "true" ? "tests" : "alerts"
              }._id`]: mongo.ObjectId(data._id)
            },
            {
              $set: {
                [`${
                  data.test === true || data.test === "true"
                    ? "tests"
                    : "alerts"
                }.$.response`]: moment().toDate(),
                last_ping: ping_update.toDate(),
                show: true
              }
            }
          )
          .then(item => {
            console.log("Alert response received");
            console.log(
              `"${item.value.name}" in "${
                item.value.branch
              }": last ping updated to: ${ping_update.format(
                "YYYY-MM-DD HH:mm:ss"
              )}`
            );
          })
          .catch(err => console.error(err));
      });

      //Set disconnect method for /devices namespace
      //Update pi in database to remove socket id
      socket.on("disconnect", () =>
        pi_list_col
          .findOneAndUpdate(
            { socket_id: socket.id },
            {
              $set: {
                socket_id: "NA"
              }
            }
          )
          .then(item =>
            console.log(
              `"${item.value.name}" disconnected from "${item.value.branch}"`
            )
          )
          .catch(err => console.error(err))
      );
    });

    //Create /status namespace for react-based socket status sheet
    const status = io.of("/status");
    //Set larger scope of status report interval
    let status_report_interval;
    //Set connection method for /status namespace
    status.on("connection", socket => {
      console.log("Status client connected");
      //Query database for all pi's and emit result to /status namespace
      status_report = () =>
        pi_list_col
          .find({})
          .toArray()
          .then(res => socket.emit("status_report", res))
          .catch(err => console.error(err));
      status_report();
      //Clear status report interval
      if (status_report_interval) clearInterval(status_report_interval);
      //Run emit status every 5 seconds
      status_report_interval = setInterval(status_report, 5000);
      //Set disconnect method for /status namespace
      socket.on("disconnect", () => console.log("Status client disconnected"));
      //Set remove_pi method from status sheet
      socket.on("remove_pi", id =>
        //Remove pi in database by _id
        pi_list_col
          .updateOne({ _id: mongo.ObjectId(id) }, { $set: { show: false } })
          .then(() => {
            status_report;
            console.log(`pi _id:"${_id}" removed from database`);
          })
          .catch(err => console.error(err))
      );
      //Set remove_pi_error method from status sheet
      socket.on("remove_pi_error", id =>
        //Remove pi in database by _id
        pi_list_col
          .updateOne({ _id: mongo.ObjectId(id) }, { $set: { error: false } })
          .then(() => {
            status_report;
            console.log(`pi _id:"${_id}" ERROR cleared`);
          })
          .catch(err => console.error(err))
      );
    });

    //Choose what to do on "/alert" url
    app.use(
      router.post("/alert", (req, res) => {
        console.log("Alert Received via HTTP:", req.body);
        //If alert does not have correct data then reject the data and return
        if (
          !req.body ||
          !req.body.unit ||
          !req.body.msg ||
          !req.body.alert_all ||
          !req.body.branch ||
          !req.body.alert_all_branch ||
          !req.body.test ||
          !req.body.name
        ) {
          return res.status(401).send("ERROR: Check data stream.");
        }
        //If data is formatted correctly then save the data to the alert request list in the database
        const new_alert = new alert_factory(req.body);
        pi_list_col
          .updateOne(
            {
              branch: new_alert.branch,
              name: new_alert.name
            },
            {
              $push: {
                [`${
                  new_alert.test === true || new_alert.test === "true"
                    ? "tests"
                    : "alerts"
                }`]: { $each: [new_alert], $slice: -10000 }
              }
            }
          )
          .then(item =>
            http_req_col
              .insertOne(new_alert)
              .then(item => {
                //On successful save to database emit alert appropriately
                //If allert_all is true then send to all devices
                if (String(new_alert.alert_all) === "true") {
                  if (String(new_alert.test) === "true") {
                    devices.emit("test", new_alert);
                  } else {
                    devices.emit("alert", new_alert);
                  }
                } else {
                  //If alert_all is false and alert_all_branch is true then send to all devices in the room/Branch
                  if (String(new_alert.alert_all_branch) === "true") {
                    if (String(new_alert.test) === "true") {
                      devices.in(new_alert.branch).emit("test", new_alert);
                    } else {
                      devices.in(new_alert.branch).emit("alert", new_alert);
                    }
                  } else {
                    //If alert_all is false and alert_all_branch is false then send to named pi
                    //Find the pi in the database by searching the name from the alert and getting the current socket_id
                    const pi = pi_list_col
                      .find(
                        { name: new_alert.name, branch: new_alert.branch },
                        { alerts: false, test: false }
                      )
                      .toArray()
                      .then(pi_item => {
                        const item = pi_item[0];
                        //If "test" is true or socket id is not "NA", null, undefined then send a test alert
                        if (
                          String(new_alert.test) === "true" &&
                          item.socket_id !== "NA" &&
                          item.socket_id !== undefined &&
                          item.socket_id !== null
                        ) {
                          devices.to(item.socket_id).emit("test", new_alert);
                          //Otherwise send a real alert
                        } else if (item.socket_id !== "NA") {
                          devices.to(item.socket_id).emit("alert", new_alert);
                        }
                      })
                      .catch(err => console.error(err));
                  }
                }
                res
                  .status(200)
                  .send({ response: `Alert sent: ${moment().toDate()}` });
              })
              .catch(err => {
                console.error(err);
                res.status(500).send({ response: "DB_SAVE_REQ_ERROR" });
              })
          )
          .catch(err => console.error(err));
      })
    );

    //Set server to listen on port defined in settings
    server.listen(settings.port, () =>
      console.log(`Server listening on port '${settings.port}'`)
    );
  })
  .catch(err => {
    console.log(err);
    console.error("Database connection error");
  });
