import { useEffect, useState } from "react";
import AvatarImg from "../AvatarImg";

function Network() {
    const [data, setData] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchData = async () => {
        try {
            const response = await fetch('http://localhost:2567/api/network/online');
            if (!response.ok) {
                throw new Error('Players not found.');
            }
            const data = await response.json();
            setData(data);
            setLoading(false);
        } catch (error) {
            setError(error.message);
            setLoading(false);
        }
    };
    useEffect(() => {
        fetchData();
    }, []);

    return (
        <div className="Content">
            <div className="Main">
                <p> Online Players: </p>
                <div className="CenterFlex">
                    {loading ? (
                        <p>Loading...</p>
                    ) : error ? (
                        <p>Error: {error}</p>
                    ) : (
                        renderPlayers(data.network)
                    )}
                </div>
                <p> Available Rooms: {data.playing}</p>
                <div className="CenterFlex">
                    {loading ? (
                        <p>Loading...</p>
                    ) : error ? (
                        <p>Error: {error}</p>
                    ) : (
                        renderRooms(data.rooms)
                    )}
                </div>
            </div>
        </div>
    )
}

function renderPlayers(players) {
    let render = [];

    for (const player of players) {
        render.push(
            <div className="Coolbox">
                <a href={"/user/" + player}>
                    <AvatarImg className='SmallAvatar' src={"http://localhost:2567/api/avatar/" + btoa(player)}></AvatarImg>
                    <br></br><span>{player}</span>
                </a>
            </div>
        )
    }

    if (render.length < 1) {

    }

    return render;
}

function renderRooms(rooms) {
    let render = [];

    for (const room of rooms) {
        render.push(
            <div className="Coolbox">
                <span className="BigText">Code: {room.code}</span><br></br>
                <span className="BigText">Player: {room.player}</span><br></br>
                <span className="BigText">Ping: {room.ping}ms</span>
            </div>
        )
    }

    if (render.length < 1) {
        render.push(
            <div>
                <iframe title=":(" src="https://www.youtube.com/embed/v4YHIYXao9I?autoplay=1" width="560" height="315" frameborder="0" allowfullscreen></iframe> <br/>
            </div>
        )
    }

    return render;
}

export default Network;