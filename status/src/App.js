import React, { Component } from "react";
import Container from "react-bootstrap/Container";
import Row from "react-bootstrap/Row";
import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";
import socketIOClient from "socket.io-client";
import moment from "moment";

class App extends Component {
  constructor() {
    super();
    this.state = {
      now: null,
      response: false,
      branch_list: [],
      socket: socketIOClient("http://localhost:6723/status")
    };
  }

  componentDidMount = () =>
    this.state.socket.on("status_report", pi_list =>
      this.setState({
        response: pi_list,
        now: moment(),
        branch_list: pi_list
          .map(e => e.branch)
          .filter((elem, pos, arr) => String(arr.indexOf(elem)) === String(pos))
      })
    );

  remove_pi = _id => this.state.socket.emit("remove_pi", _id);

  remove_pi_error = _id => this.state.socket.emit("remove_pi_error", _id);

  render = () => (
    <Container>
      <Row className="text-center">
        <h1 style={{ textAlign: "center" }}>Station Alerter Status</h1>
        <h6 style={{ textAlign: "right" }}>
          {`Last updated: 
          ${
            this.state.now
              ? this.state.now.format("dddd, MMMM Do YYYY") +
                " at " +
                this.state.now.format("HH:mm:ss")
              : "NA"
          }`}
        </h6>
        {this.state.response ? (
          this.state.branch_list.map((branch, i) => (
            <div key={i} style={{ textAlign: "left", width: "100%" }}>
              <h3>{branch}</h3>
              <Table
                striped
                bordered
                hover
                size="sm"
                variant="dark"
                style={{ fontSize: "85%" }}
              >
                <thead>
                  <tr>
                    <th width="15%">Status</th>
                    <th width="10%">Name</th>
                    <th width="15%">Last Ping</th>
                    <th width="5%">Version</th>
                    <th width="25%">Socket ID</th>
                    <th width="10%"># of Alerts</th>
                    <th width="20%">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {this.state.response.map((pi, ind) =>
                    pi.show === true && pi.branch === branch ? (
                      <tr key={ind}>
                        <td>
                          <span
                            className={
                              pi.socket_id === "NA"
                                ? "dot_red"
                                : pi.error !== false
                                ? "dot_orange"
                                : "dot_green"
                            }
                          />
                          {pi.socket_id === "NA"
                            ? "Disconnected"
                            : pi.error !== false
                            ? "Error"
                            : "Connected"}
                        </td>
                        <td>{pi.name}</td>
                        <td>{moment(pi.last_ping).fromNow()}</td>
                        <td className="text-center">{pi.version}</td>
                        <td>{pi.socket_id}</td>
                        <td className="text-center">{pi.alerts.length}</td>
                        <td className="text-center">
                          {pi.error !== false && pi.socket_id !== "NA" && (
                            <Button
                              variant="warning"
                              size="sm"
                              onClick={() => this.remove_pi_error(pi._id)}
                              style={{ margin: "0px 5px" }}
                            >
                              Clear Error
                            </Button>
                          )}
                          {(pi.error !== false || pi.socket_id === "NA") && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => this.remove_pi(pi._id)}
                              style={{ margin: "0px 5px" }}
                            >
                              Remove Device
                            </Button>
                          )}
                        </td>
                      </tr>
                    ) : null
                  )}
                </tbody>
              </Table>
              <hr />
            </div>
          ))
        ) : (
          <h1>
            <b>Loading...</b>
          </h1>
        )}
      </Row>
    </Container>
  );
}
export default App;
